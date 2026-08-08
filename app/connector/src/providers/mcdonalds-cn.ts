/**
 * Action and signing semantics adapted from OpenConnector revision
 * e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1. Jai uses an internal credential map,
 * injected clock/fetcher, cancellation and allow-listed cross-process errors.
 */
import { createHash } from "node:crypto";
import { Result, type Result as ResultType } from "better-result";
import { ConnectorProviderFailed, ConnectorProviderRateLimited, ConnectorProviderUnavailable } from "../errors";
import type {
	ActionDefinition,
	ActionExecutionContext,
	ConnectorFailure,
	JsonObject,
	JsonSchema,
	JsonValue,
	ProviderAdapter,
} from "../types";

export interface McDonaldsCnAdapterOptions {
	readonly fetcher?: McDonaldsCnFetcher;
	readonly now?: () => number;
	readonly userAgent?: string;
}

export type McDonaldsCnFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const stringSchema: JsonSchema = { type: "string", minLength: 1 };
const flagSchema: JsonSchema = { type: "string", enum: ["0", "1"] };
const dateSchema: JsonSchema = { type: "string", description: "Date in yyyyMMdd format." };
const timeSchema: JsonSchema = { type: "string", description: "Time in HH:mm format." };
const integerSchema: JsonSchema = { type: "integer" };

const actionSpecs: readonly {
	readonly actionId: string;
	readonly description: string;
	readonly path: string;
	readonly method: "GET" | "POST";
	readonly properties: Readonly<Record<string, JsonSchema>>;
	readonly required?: readonly string[];
}[] = [
	{
		actionId: "get_cities",
		description: "Get McDonald's China cities that support restaurant and menu lookup.",
		path: "/cities/all",
		method: "GET",
		properties: { getCurrent: flagSchema },
	},
	{
		actionId: "search_stores",
		description: "Search McDonald's China stores by address, city, location, keyword, or order filters.",
		path: "/stores/vicinity",
		method: "GET",
		properties: {
			addressId: stringSchema,
			beType: stringSchema,
			cityCode: stringSchema,
			date: dateSchema,
			distance: stringSchema,
			hotTagCode: stringSchema,
			isCityCenter: flagSchema,
			keyword: stringSchema,
			latitude: stringSchema,
			longitude: stringSchema,
			orderType: stringSchema,
			showType: stringSchema,
			time: timeSchema,
		},
	},
	{
		actionId: "get_store",
		description: "Get one McDonald's China store by store code.",
		path: "/stores",
		method: "GET",
		properties: { storeCode: stringSchema },
		required: ["storeCode"],
	},
	{
		actionId: "get_store_business",
		description: "Get McDonald's China business details for a store business entity code.",
		path: "/stores/be",
		method: "GET",
		properties: { beCode: stringSchema, date: dateSchema, isGroupMeal: flagSchema, time: timeSchema },
		required: ["beCode"],
	},
	{
		actionId: "get_menu",
		description: "Get a McDonald's China store menu for an order type, daypart, and sales channel.",
		path: "/products/menu",
		method: "POST",
		properties: {
			storeCode: stringSchema,
			channelCode: stringSchema,
			orderType: integerSchema,
			dayPartCode: integerSchema,
			beCode: stringSchema,
			date: dateSchema,
			time: timeSchema,
			isGroupMeal: integerSchema,
		},
		required: ["storeCode", "channelCode", "orderType", "dayPartCode"],
	},
	{
		actionId: "get_product_detail",
		description: "Get detailed McDonald's China menu product information.",
		path: "/products/detail",
		method: "GET",
		properties: {
			code: stringSchema,
			storeCode: stringSchema,
			channelCode: stringSchema,
			daypartCode: stringSchema,
			orderType: stringSchema,
			beCode: stringSchema,
			cardId: stringSchema,
			date: dateSchema,
			time: timeSchema,
			isGroupMeal: flagSchema,
		},
		required: ["code", "storeCode", "channelCode", "daypartCode", "orderType"],
	},
	{
		actionId: "search_products",
		description: "Search McDonald's China menu products for one store, daypart, and order type.",
		path: "/products/search",
		method: "GET",
		properties: {
			keyword: stringSchema,
			storeCode: stringSchema,
			daypartCode: stringSchema,
			orderType: stringSchema,
			beCode: stringSchema,
			date: dateSchema,
			time: timeSchema,
			isGroupMeal: flagSchema,
		},
		required: ["keyword", "storeCode", "daypartCode", "orderType"],
	},
];

export function createMcDonaldsCnAdapter(options: McDonaldsCnAdapterOptions = {}): ProviderAdapter {
	const fetcher: McDonaldsCnFetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
	const now = options.now ?? Date.now;
	const actions = actionSpecs.map((spec) => toActionDefinition(spec));
	return {
		definition: {
			id: "mcdonalds_cn",
			displayName: "McDonald's China",
			description: "McDonald's China store, menu and product lookup through the Open Platform APIs.",
			categories: ["location", "food", "data"],
			authTypes: ["custom_credential"],
		},
		actions,
		execute: (action, input, context) =>
			executeMcDonaldsCn(
				action,
				input,
				context,
				fetcher,
				now,
				options.userAgent ?? "jai-connector-mcdonalds-cn/0.1",
			),
	};
}

function toActionDefinition(spec: (typeof actionSpecs)[number]): ActionDefinition {
	return {
		providerId: "mcdonalds_cn",
		actionId: spec.actionId,
		description: spec.description,
		inputSchema: {
			type: "object",
			properties: spec.properties,
			required: spec.required,
			additionalProperties: false,
		},
		outputSchema: { type: "object", description: "McDonald's China provider response envelope." },
		requiredScopes: ["mcdonalds_cn.read"],
		sideEffect: "read",
		dataSensitivity: "normal",
		defaultPolicy: "query",
	};
}

async function executeMcDonaldsCn(
	action: ActionDefinition,
	input: JsonObject,
	context: ActionExecutionContext,
	fetcher: McDonaldsCnFetcher,
	now: () => number,
	userAgent: string,
): Promise<ResultType<JsonValue, ConnectorFailure>> {
	const appId = context.credentials.appId;
	const merchantId = context.credentials.merchantId;
	const signingKey = context.credentials.signingKey;
	if (!appId || !merchantId || !signingKey) {
		return Result.err(
			new ConnectorProviderUnavailable({
				message: "McDonald's China credential is not configured",
				data: { providerId: "mcdonalds_cn", actionId: action.actionId },
			}),
		);
	}
	const environment = context.credentials.environment?.toLowerCase() === "uat" ? "uat" : "prod";
	const baseUrl = environment === "uat" ? "https://api-uat.open.mcdchina.net" : "https://api.open.mcd.cn";
	const spec = actionSpecs.find((candidate) => candidate.actionId === action.actionId);
	if (!spec)
		return Result.err(
			new ConnectorProviderFailed({
				message: "McDonald's China Action is not implemented",
				data: { providerId: "mcdonalds_cn", actionId: action.actionId },
			}),
		);
	const request = buildRequest(spec, input);
	const timestamp = String(now());
	const body =
		spec.method === "POST" ? JSON.stringify(compactObject(inputForBody(action.actionId, input))) : undefined;
	const signBody = body ?? buildGetSignBody(request.path, request.query);
	const headers = new Headers({
		accept: "application/json",
		AppId: appId,
		MerchantId: merchantId,
		Timestamp: timestamp,
		Sign: createHash("md5")
			.update(
				`AppId=${appId}&Body=${signBody}&MerchantId=${merchantId}&Timestamp=${timestamp}&key=${signingKey}`,
				"utf8",
			)
			.digest("hex")
			.toUpperCase(),
		Version: "1.0",
		"user-agent": userAgent,
	});
	if (body !== undefined) headers.set("content-type", "application/json");
	const url = new URL(request.path, baseUrl);
	for (const [key, value] of request.query) url.searchParams.set(key, value);
	try {
		const response = await fetcher(url, {
			method: spec.method,
			headers,
			...(body === undefined ? {} : { body }),
			signal: context.signal,
		});
		const payload: unknown = await response.json().catch(() => undefined);
		const retryAfter = retryAfterMs(response);
		if (response.status === 429)
			return Result.err(
				new ConnectorProviderRateLimited({
					message: "McDonald's China rate limit exceeded",
					data: {
						providerId: "mcdonalds_cn",
						actionId: action.actionId,
						...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
					},
				}),
			);
		if (response.status >= 500)
			return Result.err(
				new ConnectorProviderUnavailable({
					message: "McDonald's China is temporarily unavailable",
					data: { providerId: "mcdonalds_cn", actionId: action.actionId, status: response.status },
				}),
			);
		if (!response.ok)
			return Result.err(
				new ConnectorProviderFailed({
					message: "McDonald's China rejected the request",
					data: { providerId: "mcdonalds_cn", actionId: action.actionId, status: response.status },
				}),
			);
		if (!isJsonValue(payload))
			return Result.err(
				new ConnectorProviderFailed({
					message: "McDonald's China returned an invalid JSON response",
					data: { providerId: "mcdonalds_cn", actionId: action.actionId, status: response.status },
				}),
			);
		if (isProviderFailure(payload))
			return Result.err(
				new ConnectorProviderFailed({
					message: providerErrorMessage(payload),
					data: { providerId: "mcdonalds_cn", actionId: action.actionId, status: response.status },
				}),
			);
		return Result.ok(payload);
	} catch (cause) {
		return Result.err(
			new ConnectorProviderUnavailable({
				message: "McDonald's China request failed",
				data: { providerId: "mcdonalds_cn", actionId: action.actionId },
				cause,
			}),
		);
	}
}

function buildRequest(
	spec: (typeof actionSpecs)[number],
	input: JsonObject,
): { readonly path: string; readonly query: readonly [string, string][] } {
	if (spec.actionId === "get_store")
		return { path: `${spec.path}/${encodeURIComponent(stringInput(input, "storeCode"))}`, query: [] };
	if (spec.actionId === "get_store_business")
		return {
			path: `${spec.path}/${encodeURIComponent(stringInput(input, "beCode"))}`,
			query: queryEntries(input, ["date", "isGroupMeal", "time"]),
		};
	if (spec.actionId === "get_product_detail")
		return {
			path: `${spec.path}/${encodeURIComponent(stringInput(input, "code"))}`,
			query: queryEntries(input, [
				"beCode",
				"cardId",
				"channelCode",
				"date",
				"daypartCode",
				"isGroupMeal",
				"orderType",
				"storeCode",
				"time",
			]),
		};
	if (spec.method === "POST") return { path: spec.path, query: [] };
	return { path: spec.path, query: queryEntries(input, Object.keys(input)) };
}

function inputForBody(actionId: string, input: JsonObject): JsonObject {
	if (actionId !== "get_menu") return input;
	return {
		date: input.date,
		orderType: input.orderType,
		beCode: input.beCode,
		dayPartCode: input.dayPartCode,
		time: input.time,
		isGroupMeal: input.isGroupMeal,
		channelCode: input.channelCode,
		storeCode: input.storeCode,
	};
}

function queryEntries(input: JsonObject, keys: readonly string[]): [string, string][] {
	return keys.flatMap((key) => {
		const value = input[key];
		return value === null || value === undefined || value === ""
			? []
			: typeof value === "string" || typeof value === "number" || typeof value === "boolean"
				? [[key, String(value)]]
				: [];
	});
}

function buildGetSignBody(path: string, query: readonly [string, string][]): string {
	return query.length === 0 ? path : `${path}?${query.map(([key, value]) => `${key}=${value}`).join("&")}`;
}

function compactObject(value: JsonObject): JsonObject {
	return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject;
}

function stringInput(input: JsonObject, key: string): string {
	const value = input[key];
	return typeof value === "string" ? value : "";
}

function isProviderFailure(value: JsonValue): value is JsonObject & { readonly success: false } {
	return typeof value === "object" && value !== null && !Array.isArray(value) && value.success === false;
}

function providerErrorMessage(value: JsonObject): string {
	return typeof value.message === "string"
		? value.message
		: typeof value.msg === "string"
			? value.msg
			: typeof value.code === "string" || typeof value.code === "number"
				? `McDonald's China returned code ${value.code}`
				: "McDonald's China request failed";
}

function retryAfterMs(response: Response): number | undefined {
	const seconds = Number(response.headers.get("retry-after"));
	return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : undefined;
}

function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string")
		return true;
	if (Array.isArray(value)) return value.every(isJsonValue);
	return typeof value === "object" && value !== null && Object.values(value).every(isJsonValue);
}
