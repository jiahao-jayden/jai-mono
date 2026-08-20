import { randomUUID } from "node:crypto";
import {
	type CodingAgentExtension,
	type CodingExtensionContext,
	type CodingExtensionTool,
	type CodingExtensionToolResult,
	defineExtension,
} from "@jai/coding-agent";
import {
	ConnectorInputInvalid,
	type ConnectorService,
	isJsonObject,
	type JsonObject,
	type PrepareActionInput,
} from "@jai/connector";
import { type Static, Type } from "@sinclair/typebox";
import { TaggedError } from "better-result";

export interface ConnectorExtensionOptions {
	readonly client: ConnectorService;
}

class ConnectorExtensionPermissionDenied extends TaggedError("connector_extension.permission_denied")<{
	readonly data: { readonly actionId: string; readonly reason: "denied" | "dont_ask" | "plan" };
	readonly message: string;
}> {}

const emptyParameters = Type.Object({}, { additionalProperties: false });
const searchParameters = Type.Object(
	{
		query: Type.Optional(Type.String()),
		connectorId: Type.Optional(Type.String()),
		sideEffect: Type.Optional(Type.Union([Type.Literal("read"), Type.Literal("write"), Type.Literal("destructive")])),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
	},
	{ additionalProperties: false },
);
const guideParameters = Type.Object({ actionId: Type.String({ minLength: 1 }) }, { additionalProperties: false });
const executeParameters = Type.Object(
	{
		actionId: Type.String({ minLength: 1 }),
		input: Type.Record(Type.String(), Type.Unknown()),
	},
	{ additionalProperties: false },
);
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
		connectors: Type.Optional(
			Type.Record(
				Type.String({ minLength: 1 }),
				Type.Object(
					{
						enabled: Type.Optional(Type.Boolean()),
						credentials: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.String())),
					},
					{ additionalProperties: false },
				),
			),
		),
	},
	{ additionalProperties: false },
);
type ConnectorExtensionConfiguration = Static<typeof connectorConfigurationSchema>;
const connectorDefaultConfiguration: ConnectorExtensionConfiguration = {
	policy: { default: "ask", actions: {} },
	connectors: {},
};

export function createConnectorExtension(
	options: ConnectorExtensionOptions,
): CodingAgentExtension<ConnectorExtensionConfiguration> {
	return defineExtension<ConnectorExtensionConfiguration>({
		id: "connector",
		configuration: {
			scope: "user",
			schema: connectorConfigurationSchema,
			defaultValue: connectorDefaultConfiguration,
		},
		initialize: (context) => {
			const tools: readonly CodingExtensionTool[] = [
				{
					name: "connector__list_apps",
					description: "List enabled Connectors and safe connection summaries.",
					parameters: emptyParameters,
					authorization: {
						owner: "core",
						permission: { sideEffect: "read", reason: "Lists available Connector applications." },
					},
					executionMode: "parallel",
					execute: async ({ toolCallId, signal }) => {
						const result = await options.client.listApps(requestContext(context.sessionId, toolCallId, signal));
						if (result.isErr()) throw result.error;
						return textResult(result.value);
					},
				},
				{
					name: "connector__list_connections",
					description: "List Connector account connections, health and scope summaries.",
					parameters: emptyParameters,
					authorization: {
						owner: "core",
						permission: { sideEffect: "read", reason: "Lists Connector connection summaries." },
					},
					executionMode: "parallel",
					execute: async ({ toolCallId, signal }) => {
						const result = await options.client.listConnections(
							requestContext(context.sessionId, toolCallId, signal),
						);
						if (result.isErr()) throw result.error;
						return textResult(result.value);
					},
				},
				{
					name: "connector__search_actions",
					description: "Search available Connector Actions without exposing Connector-specific tools.",
					parameters: searchParameters,
					authorization: {
						owner: "core",
						permission: { sideEffect: "read", reason: "Searches available Connector Actions." },
					},
					executionMode: "parallel",
					execute: async ({ toolCallId, args, signal }) => {
						const result = await options.client.searchActions(
							args as Static<typeof searchParameters>,
							requestContext(context.sessionId, toolCallId, signal),
						);
						if (result.isErr()) throw result.error;
						return textResult(result.value);
					},
				},
				{
					name: "connector__get_action_guide",
					description: "Get the input/output schema and usage guide for one Connector Action.",
					parameters: guideParameters,
					authorization: {
						owner: "core",
						permission: { sideEffect: "read", reason: "Reads a Connector Action guide." },
					},
					executionMode: "parallel",
					execute: async ({ toolCallId, args, signal }) => {
						const result = await options.client.getActionGuide(
							args as Static<typeof guideParameters>,
							requestContext(context.sessionId, toolCallId, signal),
						);
						if (result.isErr()) throw result.error;
						return textResult(result.value);
					},
				},
				{
					name: "connector__execute_action",
					description: "Execute one Connector Action after discovering its guide.",
					parameters: executeParameters,
					executionMode: "sequential",
					authorization: { owner: "extension" },
					execute: async ({ toolCallId, args, signal }) =>
						executeConnectorAction(options.client, context, toolCallId, executeInput(args), signal),
				},
			];
			return { tools };
		},
	});
}

async function executeConnectorAction(
	client: ConnectorService,
	context: CodingExtensionContext<ConnectorExtensionConfiguration>,
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
			const decision = await context.requestApproval(
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
	configuration: CodingExtensionContext<ConnectorExtensionConfiguration>["configuration"],
	actionId: string,
): Promise<void> {
	const current = configuration.value;
	await configuration.update({
		...current,
		policy: {
			...(current.policy ?? {}),
			actions: { ...(current.policy?.actions ?? {}), [actionId]: "allow" },
		},
	});
}

function executeInput(args: JsonObject): PrepareActionInput {
	const actionId = args.actionId;
	const input = args.input;
	if (typeof actionId !== "string" || !isJsonObject(input)) {
		throw new ConnectorInputInvalid({
			message: "Connector Action input must include an action ID and JSON object input",
			data: { actionId: typeof actionId === "string" ? actionId : "", reason: "invalid tool arguments" },
		});
	}
	return { actionId, input };
}

function requestContext(sessionId: string, requestId: string, signal?: AbortSignal) {
	return { sessionId, requestId, ...(signal ? { signal } : {}) };
}

function textResult(value: unknown): CodingExtensionToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(value) ?? "" }],
	};
}
