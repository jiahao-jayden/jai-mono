import type { AgentTool, AgentToolResult } from "@jai/agent";
import {
	type ConnectorFailure,
	ConnectorRemoteFailure,
	type ConnectorService,
	type ExecuteActionInput,
	isJsonObject,
	type RequestContext,
} from "@jai/connector";
import { type Static, Type } from "@sinclair/typebox";
import { ConnectorAgentApprovalDenied, ConnectorAgentToolFailed } from "./errors";

export interface ConnectorApprovalRequest {
	readonly requestId: string;
	readonly sessionId: string;
	readonly toolCallId: string;
	readonly toolName: "connector__execute_action";
	readonly approvalId: string;
	readonly actionId: string;
	readonly connectionAlias: string;
	readonly reason: string;
	readonly sideEffect: "read" | "write" | "destructive";
	readonly dataSensitivity: "normal" | "sensitive" | "secret";
	readonly inputKeys: readonly string[];
	readonly expiresAt: number;
}

export type ConnectorApprovalDecision = "deny" | "allowOnce" | "alwaysAllow";

export interface ConnectorAgentToolOptions {
	readonly client: ConnectorService;
	readonly sessionId: string;
	readonly requestApproval?: (
		request: ConnectorApprovalRequest,
		signal?: AbortSignal,
	) => ConnectorApprovalDecision | Promise<ConnectorApprovalDecision>;
}

const emptyParameters = Type.Object({}, { additionalProperties: false });
const searchParameters = Type.Object(
	{
		query: Type.Optional(Type.String()),
		providerId: Type.Optional(Type.String()),
		connectionAlias: Type.Optional(Type.String()),
		sideEffect: Type.Optional(Type.Union([Type.Literal("read"), Type.Literal("write"), Type.Literal("destructive")])),
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
	},
	{ additionalProperties: false },
);
const guideParameters = Type.Object(
	{ actionId: Type.String({ minLength: 1 }), connectionAlias: Type.Optional(Type.String({ minLength: 1 })) },
	{ additionalProperties: false },
);
const executeParameters = Type.Object(
	{
		actionId: Type.String({ minLength: 1 }),
		connectionAlias: Type.Optional(Type.String({ minLength: 1 })),
		input: Type.Record(Type.String(), Type.Unknown()),
	},
	{ additionalProperties: false },
);

export function createConnectorTools(options: ConnectorAgentToolOptions): AgentTool[] {
	return [
		createSimpleTool(
			"connector__list_apps",
			"List enabled Connector Providers and safe connection summaries.",
			emptyParameters,
			(toolCallId, _input, signal) => options.client.listApps(context(options.sessionId, toolCallId, signal)),
		),
		createSimpleTool(
			"connector__list_connections",
			"List Connector Connections, aliases, health and scope summaries.",
			emptyParameters,
			(toolCallId, _input, signal) => options.client.listConnections(context(options.sessionId, toolCallId, signal)),
		),
		createSimpleTool(
			"connector__search_actions",
			"Search available Connector Actions without exposing Provider-specific tools.",
			searchParameters,
			(toolCallId, input, signal) =>
				options.client.searchActions(
					input as Static<typeof searchParameters>,
					context(options.sessionId, toolCallId, signal),
				),
		),
		createSimpleTool(
			"connector__get_action_guide",
			"Get the input/output schema and usage guide for one Connector Action.",
			guideParameters,
			(toolCallId, input, signal) =>
				options.client.getActionGuide(
					input as Static<typeof guideParameters>,
					context(options.sessionId, toolCallId, signal),
				),
		),
		{
			name: "connector__execute_action",
			description: "Execute one policy-approved Connector Action after discovering its guide.",
			parameters: executeParameters,
			executionMode: "sequential",
			execute: async (toolCallId, input, signal) => {
				const args = input as Static<typeof executeParameters>;
				if (!isJsonObject(args.input)) {
					throw new ConnectorAgentToolFailed({
						message: "Connector Action input must be a JSON object",
						data: { toolName: "connector__execute_action", code: "connector.input_invalid" },
					});
				}
				const actionInput: ExecuteActionInput = { ...args, input: args.input };
				const requestContext = context(options.sessionId, toolCallId, signal);
				const first = await options.client.executeAction(actionInput, requestContext);
				if (first.isErr())
					throw new ConnectorAgentToolFailed({
						message: first.error.message,
						data: { toolName: "connector__execute_action", code: connectorErrorCode(first.error) },
						cause: first.error,
					});
				if (first.value.status === "completed") return projectResponse(first.value);
				if (!options.requestApproval)
					throw new ConnectorAgentToolFailed({
						message: "Connector approval is required but no approval handler is configured",
						data: { toolName: "connector__execute_action", code: "connector.approval_required" },
					});
				const approval = await options.requestApproval(
					{
						requestId: first.value.approvalId,
						sessionId: options.sessionId,
						toolCallId,
						toolName: "connector__execute_action",
						approvalId: first.value.approvalId,
						actionId: first.value.approval.actionId,
						connectionAlias: first.value.approval.connectionAlias,
						reason: first.value.approval.description,
						sideEffect: first.value.approval.sideEffect,
						dataSensitivity: first.value.approval.dataSensitivity,
						inputKeys: first.value.approval.inputKeys,
						expiresAt: first.value.approval.expiresAt,
					},
					signal,
				);
				if (approval === "deny")
					throw new ConnectorAgentApprovalDenied({
						message: "User denied the Connector Action",
						data: { actionId: args.actionId },
					});
				const completed = await options.client.executeAction(
					{ ...actionInput, approvalId: first.value.approvalId },
					requestContext,
				);
				if (completed.isErr())
					throw new ConnectorAgentToolFailed({
						message: completed.error.message,
						data: { toolName: "connector__execute_action", code: connectorErrorCode(completed.error) },
						cause: completed.error,
					});
				return projectResponse(completed.value);
			},
		},
	];
}

function createSimpleTool<T extends ReturnType<typeof Type.Object>>(
	name: string,
	description: string,
	parameters: T,
	call: (toolCallId: string, input: Static<T>, signal?: AbortSignal) => Promise<unknown>,
): AgentTool<T> {
	return {
		name,
		description,
		parameters,
		executionMode: "parallel",
		execute: async (toolCallId, input, signal) => {
			try {
				return projectResponse(await call(toolCallId, input, signal));
			} catch (cause) {
				throw new ConnectorAgentToolFailed({
					message: `Connector tool ${name} failed`,
					data: { toolName: name },
					cause,
				});
			}
		},
	};
}

function context(sessionId: string, requestId: string, signal?: AbortSignal): RequestContext {
	return { sessionId, requestId, ...(signal ? { signal } : {}) };
}

function connectorErrorCode(error: ConnectorFailure): string {
	return error instanceof ConnectorRemoteFailure ? error.data.code : error._tag;
}

function projectResponse(value: unknown): AgentToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(value) ?? "" }],
		details: value,
	};
}
