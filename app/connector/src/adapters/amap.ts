/**
 * Action semantics adapted from OpenConnector revision
 * e298b5aa13e899a3e77d519e7c9ee3104e1fc5d1. Jai uses injected fetch/cancellation,
 * Service-owned credentials and Jai Connector error DTOs.
 */
import { Result, type Result as ResultType } from "better-result";
import { ConnectorUpstreamFailed, ConnectorUpstreamRateLimited, ConnectorUpstreamUnavailable } from "../errors";
import type {
	ActionDefinition,
	ActionExecutionContext,
	ConnectorAdapter,
	ConnectorFailure,
	JsonObject,
	JsonSchema,
	JsonValue,
} from "../types";

export interface AMapAdapterOptions {
	readonly baseUrl?: string;
	readonly fetcher?: AMapFetcher;
	readonly userAgent?: string;
}

export type AMapFetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type AMapActionSpec = {
	readonly actionId: string;
	readonly path: string;
	readonly description: string;
	readonly properties: Readonly<Record<string, JsonSchema>>;
	readonly required?: readonly string[];
};

const stringSchema: JsonSchema = { type: "string", minLength: 1 };
const integerSchema: JsonSchema = { type: "integer" };
const extensionsSchema: JsonSchema = { type: "string", enum: ["base", "all"] };

const actionSpecs: readonly AMapActionSpec[] = [
	{
		actionId: "geocode",
		path: "/v3/geocode/geo",
		description: "Convert a structured address into AMap coordinates.",
		properties: { address: stringSchema, city: stringSchema, batch: { type: "string", enum: ["true", "false"] } },
		required: ["address"],
	},
	{
		actionId: "reverse_geocode",
		path: "/v3/geocode/regeo",
		description: "Convert coordinates into an address and nearby geographic details.",
		properties: {
			location: stringSchema,
			poitype: stringSchema,
			radius: integerSchema,
			extensions: extensionsSchema,
			roadlevel: { type: "string", enum: ["road", "street"] },
			homeorcorp: { type: "string", enum: ["0", "1", "2"] },
		},
		required: ["location"],
	},
	{
		actionId: "search_places",
		path: "/v5/place/text",
		description: "Search AMap POIs by keyword, type and city.",
		properties: {
			keywords: stringSchema,
			region: stringSchema,
			cityLimit: { type: "boolean" },
			types: stringSchema,
			pageNum: integerSchema,
			pageSize: integerSchema,
			showFields: stringSchema,
		},
	},
	{
		actionId: "search_places_around",
		path: "/v5/place/around",
		description: "Search nearby AMap POIs around a coordinate.",
		properties: {
			location: stringSchema,
			radius: integerSchema,
			keywords: stringSchema,
			types: stringSchema,
			sortRule: stringSchema,
			pageNum: integerSchema,
			pageSize: integerSchema,
			showFields: stringSchema,
		},
		required: ["location"],
	},
	{
		actionId: "search_places_polygon",
		path: "/v5/place/polygon",
		description: "Search AMap POIs inside a polygon.",
		properties: {
			polygon: stringSchema,
			keywords: stringSchema,
			types: stringSchema,
			pageNum: integerSchema,
			pageSize: integerSchema,
			showFields: stringSchema,
		},
		required: ["polygon"],
	},
	{
		actionId: "input_tips",
		path: "/v3/assistant/inputtips",
		description: "Return address and POI suggestions for an incomplete query.",
		properties: {
			keywords: stringSchema,
			type: stringSchema,
			location: stringSchema,
			city: stringSchema,
			cityLimit: { type: "boolean" },
			dataType: stringSchema,
		},
		required: ["keywords"],
	},
	{
		actionId: "district_search",
		path: "/v3/config/district",
		description: "Query AMap administrative district boundaries and hierarchy.",
		properties: {
			keywords: stringSchema,
			subdistrict: integerSchema,
			page: integerSchema,
			offset: integerSchema,
			extensions: extensionsSchema,
			filter: stringSchema,
			showbiz: { type: "string", enum: ["0", "1"] },
		},
		required: ["keywords"],
	},
	{
		actionId: "weather",
		path: "/v3/weather/weatherInfo",
		description: "Query current or forecast weather for an AMap city adcode.",
		properties: { city: stringSchema, extensions: { type: "string", enum: ["base", "all"] } },
		required: ["city"],
	},
	{
		actionId: "route_driving",
		path: "/v5/direction/driving",
		description: "Plan a driving route between two coordinates.",
		properties: {
			origin: stringSchema,
			destination: stringSchema,
			waypoints: stringSchema,
			strategy: stringSchema,
			plate: stringSchema,
			carType: stringSchema,
			avoidPolygons: stringSchema,
			showFields: stringSchema,
		},
		required: ["origin", "destination"],
	},
	{
		actionId: "route_walking",
		path: "/v5/direction/walking",
		description: "Plan a walking route between two coordinates.",
		properties: { origin: stringSchema, destination: stringSchema, showFields: stringSchema },
		required: ["origin", "destination"],
	},
	{
		actionId: "route_bicycling",
		path: "/v5/direction/bicycling",
		description: "Plan a bicycling route between two coordinates.",
		properties: {
			origin: stringSchema,
			destination: stringSchema,
			alternativeRoute: stringSchema,
			showFields: stringSchema,
		},
		required: ["origin", "destination"],
	},
	{
		actionId: "route_electrobike",
		path: "/v5/direction/electrobike",
		description: "Plan an electric bicycle route between two coordinates.",
		properties: { origin: stringSchema, destination: stringSchema, showFields: stringSchema },
		required: ["origin", "destination"],
	},
	{
		actionId: "route_transit",
		path: "/v5/direction/transit/integrated",
		description: "Plan an integrated public transit route between two coordinates.",
		properties: {
			origin: stringSchema,
			destination: stringSchema,
			originCity: stringSchema,
			destinationCity: stringSchema,
			strategy: stringSchema,
			nightFlag: stringSchema,
			showFields: stringSchema,
		},
		required: ["origin", "destination", "originCity", "destinationCity"],
	},
	{
		actionId: "ip_locate",
		path: "/v3/ip",
		description: "Locate an IPv4 address using AMap IP location data.",
		properties: { ip: stringSchema },
	},
	{
		actionId: "get_place_detail",
		path: "/v5/place/detail",
		description: "Retrieve details for one or more AMap POI IDs.",
		properties: { id: stringSchema, showFields: stringSchema },
		required: ["id"],
	},
];

export function createAMapAdapter(options: AMapAdapterOptions = {}): ConnectorAdapter {
	const fetcher: AMapFetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
	const baseUrl = (options.baseUrl ?? "https://restapi.amap.com").replace(/\/$/u, "");
	const actions = actionSpecs.map(toActionDefinition);
	return {
		definition: {
			id: "amap",
			displayName: "AMap",
			description: "Geocoding, POI, weather, routing and geographic data from AMap Web Service APIs.",
			categories: ["maps", "places", "geocoding", "routing"],
			authTypes: ["api_key"],
		},
		actions,
		execute: (action, input, context) =>
			executeAMap(action, input, context, fetcher, baseUrl, options.userAgent ?? "jai-connector-amap/0.1"),
	};
}

function toActionDefinition(spec: AMapActionSpec): ActionDefinition {
	return {
		connectorId: "amap",
		actionId: spec.actionId,
		description: spec.description,
		inputSchema: {
			type: "object",
			properties: spec.properties,
			required: spec.required,
			additionalProperties: false,
		},
		outputSchema: { type: "object", description: "AMap Web Service JSON response." },
		requiredScopes: ["amap.webservice.read"],
		sideEffect: "read",
		dataSensitivity: "normal",
	};
}

async function executeAMap(
	action: ActionDefinition,
	input: JsonObject,
	context: ActionExecutionContext,
	fetcher: AMapFetcher,
	baseUrl: string,
	userAgent: string,
): Promise<ResultType<JsonValue, ConnectorFailure>> {
	const key = context.credentials.apiKey;
	if (!key)
		return Result.err(
			new ConnectorUpstreamUnavailable({
				message: "AMap Web Service key is not configured",
				data: { connectorId: "amap", actionId: action.actionId },
			}),
		);
	const params = new URLSearchParams({ key, output: "JSON" });
	for (const [name, value] of amapQueryEntries(input)) {
		params.set(name, value);
	}
	try {
		const response = await fetcher(`${baseUrl}${pathFor(action.actionId)}?${params.toString()}`, {
			method: "GET",
			headers: { accept: "application/json", "user-agent": userAgent },
			signal: context.signal,
		});
		const payload: unknown = await response.json().catch(() => undefined);
		const retryAfter = retryAfterMs(response);
		if (response.status === 429)
			return Result.err(
				new ConnectorUpstreamRateLimited({
					message: "AMap rate limit exceeded",
					data: {
						connectorId: "amap",
						actionId: action.actionId,
						...(retryAfter === undefined ? {} : { retryAfterMs: retryAfter }),
					},
				}),
			);
		if (response.status >= 500)
			return Result.err(
				new ConnectorUpstreamUnavailable({
					message: "AMap is temporarily unavailable",
					data: { connectorId: "amap", actionId: action.actionId, status: response.status },
				}),
			);
		if (!response.ok)
			return Result.err(
				new ConnectorUpstreamFailed({
					message: "AMap rejected the request",
					data: { connectorId: "amap", actionId: action.actionId, status: response.status },
				}),
			);
		if (!isJsonValue(payload))
			return Result.err(
				new ConnectorUpstreamFailed({
					message: "AMap returned an invalid JSON response",
					data: { connectorId: "amap", actionId: action.actionId, status: response.status },
				}),
			);
		if (isAMapFailure(payload))
			return Result.err(
				new ConnectorUpstreamFailed({
					message: `AMap request failed: ${payload.info ?? "unknown error"}`,
					data: { connectorId: "amap", actionId: action.actionId, status: response.status },
				}),
			);
		return Result.ok(payload);
	} catch (cause) {
		return Result.err(
			new ConnectorUpstreamUnavailable({
				message: "AMap request failed",
				data: { connectorId: "amap", actionId: action.actionId },
				cause,
			}),
		);
	}
}

function pathFor(actionId: string): string {
	return actionSpecs.find((spec) => spec.actionId === actionId)?.path ?? "/v3/unsupported";
}

function amapQueryEntries(input: JsonObject): readonly [string, string][] {
	const mappings: Readonly<Record<string, string>> = {
		cityLimit: "city_limit",
		pageNum: "page_num",
		pageSize: "page_size",
		showFields: "show_fields",
		sortRule: "sortrule",
		dataType: "datatype",
		roadLevel: "roadlevel",
		carType: "cartype",
		avoidPolygons: "avoidpolygons",
		originCity: "city1",
		destinationCity: "city2",
		nightFlag: "nightflag",
		alternativeRoute: "alternative_route",
	};
	return Object.entries(input).flatMap(([name, value]) => {
		if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return [];
		const mapped = mappings[name] ?? name;
		return [[mapped, String(value)]] as const;
	});
}

function isAMapFailure(value: JsonValue): value is JsonObject & { readonly status: "0"; readonly info?: string } {
	return typeof value === "object" && value !== null && !Array.isArray(value) && value.status === "0";
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
