import { randomUUID } from "node:crypto";
import {
	type CodingAgentExtension,
	CodingExtensionOperationFailed,
	type CodingExtensionRuntime,
	type CodingExtensionTool,
	type CodingExtensionToolResult,
	defineExtension,
} from "@jai/coding-agent";
import {
	ConnectorInputInvalid,
	type ConnectorService,
	isJsonObject,
	type JsonObject,
	type JsonSchema,
	type JsonValue,
	type PrepareActionInput,
} from "@jai/connector";
import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { Result, TaggedError } from "better-result";

export interface ConnectorExtensionOptions {
	readonly client: ConnectorService;
}

class ConnectorExtensionPermissionDenied extends TaggedError("connector_extension.permission_denied")<{
	readonly data: { readonly actionId: string; readonly reason: "denied" | "dont_ask" | "plan" };
	readonly message: string;
}> {}

const connectorConfigurationSchema = Type.Object(
	{
		policy: Type.Optional(
			Type.Object(
				{
					default: Type.Optional(Type.Union([Type.Literal("ask"), Type.Literal("allow"), Type.Literal("deny")])),
					actions: Type.Optional(
						Type.Record(
							Type.String({ minLength: 1 }),
							Type.Union([Type.Literal("ask"), Type.Literal("allow"), Type.Literal("deny")]),
						),
					),
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);
type ConnectorExtensionConfiguration = Static<typeof connectorConfigurationSchema>;
const connectorDefaultConfiguration: ConnectorExtensionConfiguration = {
	policy: { default: "ask", actions: {} },
};

export function createConnectorExtension(
	options: ConnectorExtensionOptions,
): CodingAgentExtension<ConnectorExtensionConfiguration> {
	return defineExtension({
		id: "connector",
		configuration: {
			scope: "user",
			schema: connectorConfigurationSchema,
			defaultValue: connectorDefaultConfiguration,
		},
		catalogs: [
			{
				id: "actions",
				discover: async (runtime, signal) => discoverConnectorActions(options.client, runtime, signal),
				subscribe: (_runtime, invalidate) => {
					const stop = options.client.subscribe?.(invalidate);
					return () => {
						stop?.();
					};
				},
			},
		],
	});
}

async function discoverConnectorActions(
	client: ConnectorService,
	runtime: CodingExtensionRuntime<ConnectorExtensionConfiguration>,
	signal?: AbortSignal,
) {
	const request = requestContext(runtime.sessionId, randomUUID(), signal);
	const actions = await client.listActions(request);
	if (actions.isErr()) {
		return Result.err(
			new CodingExtensionOperationFailed({
				message: "Connector Action catalog discovery failed",
				cause: actions.error,
			}),
		);
	}
	const tools: CodingExtensionTool<ConnectorExtensionConfiguration>[] = [];
	for (const action of actions.value) {
		const actionId = `${action.connectorId}.${action.actionId}`;
		tools.push({
			name: `connector__${actionId.replaceAll(".", "__")}`,
			description: action.description,
			presentation: { activityKind: "call" },
			parameters: jsonSchemaToTypeBox(action.inputSchema),
			executionMode: action.sideEffect === "read" ? "parallel" : "sequential",
			authorization: { owner: "extension" },
			execute: async (toolRuntime, { toolCallId, args, signal: toolSignal }) =>
				executeConnectorAction(client, toolRuntime, toolCallId, { actionId, input: actionInput(args) }, toolSignal),
		});
	}
	return Result.ok({ tools });
}

async function executeConnectorAction(
	client: ConnectorService,
	context: CodingExtensionRuntime<ConnectorExtensionConfiguration>,
	toolCallId: string,
	input: PrepareActionInput,
	signal?: AbortSignal,
): Promise<CodingExtensionToolResult> {
	const request = requestContext(context.sessionId, toolCallId, signal);
	const preparedResult = await client.prepareAction(input, request);
	if (preparedResult.isErr()) throw preparedResult.error;
	const prepared = preparedResult.value;
	let consumed = false;
	try {
		if (context.permissionMode === "plan" && prepared.sideEffect !== "read") {
			throw new ConnectorExtensionPermissionDenied({
				message: "Plan mode only allows read-only Connector Actions",
				data: { actionId: prepared.actionId, reason: "plan" },
			});
		}
		if (prepared.approvalMode === "ask") {
			if (context.permissionMode === "dontAsk") {
				throw new ConnectorExtensionPermissionDenied({
					message: "Don't Ask mode denies Connector Actions that require approval",
					data: { actionId: prepared.actionId, reason: "dont_ask" },
				});
			}
			const approval = await context.requestApproval(
				{
					requestId: randomUUID(),
					extensionId: "connector",
					operationId: prepared.actionId,
					sessionId: context.sessionId,
					toolCallId,
					reason: `Execute Connector Action "${prepared.actionId}": ${prepared.description}`,
					sideEffect: prepared.sideEffect,
					dataSensitivity: prepared.dataSensitivity,
					presentation: {
						title: "Connector action requests permission",
						description: prepared.description,
						attributes: [
							{ label: "Action", value: prepared.actionId },
							{ label: "Input fields", value: Object.keys(input.input).sort().join(", ") || "None" },
						],
					},
					expiresAt: prepared.expiresAt,
				},
				signal,
			);
			if (approval.isErr()) throw approval.error;
			const decision = approval.value;
			if (decision === "deny") {
				throw new ConnectorExtensionPermissionDenied({
					message: "User denied the Connector Action",
					data: { actionId: prepared.actionId, reason: "denied" },
				});
			}
			if (decision === "allow") await persistActionAllow(context.configuration, prepared.actionId);
		}
		consumed = true;
		const executed = await client.executePreparedAction(prepared, request);
		if (executed.isErr()) throw executed.error;
		return textResult(executed.value);
	} finally {
		if (!consumed) await client.discardPreparedAction(prepared, request).catch(() => {});
	}
}

async function persistActionAllow(
	configuration: CodingExtensionRuntime<ConnectorExtensionConfiguration>["configuration"],
	actionId: string,
): Promise<void> {
	const current = configuration.value;
	const persisted = await configuration.update({
		...current,
		policy: {
			...(current.policy ?? {}),
			actions: { ...(current.policy?.actions ?? {}), [actionId]: "allow" },
		},
	});
	if (persisted.isErr()) throw persisted.error;
}

function actionInput(args: JsonObject): JsonObject {
	if (!isJsonObject(args)) {
		throw new ConnectorInputInvalid({
			message: "Connector Action input must be a JSON object",
			data: { actionId: "", reason: "invalid tool arguments" },
		});
	}
	return args;
}

function jsonSchemaToTypeBox(schema: JsonSchema): TSchema {
	if (schema.enum && schema.enum.length > 0) {
		const literals = schema.enum.flatMap((value) => literalSchema(value));
		if (literals.length === 1) return literals[0]!;
		if (literals.length > 1) return Type.Union(literals);
	}
	switch (schema.type) {
		case "object": {
			const required = new Set(schema.required ?? []);
			const properties = Object.fromEntries(
				Object.entries(schema.properties ?? {}).map(([name, value]) => [
					name,
					required.has(name) ? jsonSchemaToTypeBox(value) : Type.Optional(jsonSchemaToTypeBox(value)),
				]),
			) as Record<string, TSchema>;
			return Type.Object(properties, { additionalProperties: schema.additionalProperties !== false });
		}
		case "array":
			return Type.Array(schema.items ? jsonSchemaToTypeBox(schema.items) : Type.Unknown());
		case "string":
			return Type.String({
				...(schema.minLength === undefined ? {} : { minLength: schema.minLength }),
				...(schema.maxLength === undefined ? {} : { maxLength: schema.maxLength }),
			});
		case "number":
			return Type.Number();
		case "integer":
			return Type.Integer();
		case "boolean":
			return Type.Boolean();
		case "null":
			return Type.Null();
		default:
			return Type.Unknown();
	}
}

function literalSchema(value: JsonValue): TSchema[] {
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
		return [Type.Literal(value)];
	if (value === null) return [Type.Null()];
	return [];
}

function requestContext(sessionId: string, requestId: string, signal?: AbortSignal) {
	return { sessionId, requestId, ...(signal ? { signal } : {}) };
}

function textResult(value: unknown): CodingExtensionToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(value) ?? "" }],
	};
}
