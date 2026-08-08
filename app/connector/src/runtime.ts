import { createHash, randomUUID } from "node:crypto";
import { Result, type Result as ResultType } from "better-result";
import {
	ConnectorActionNotFound,
	ConnectorApprovalInvalid,
	ConnectorConnectionNotFound,
	ConnectorConnectionUnavailable,
	ConnectorInputInvalid,
	ConnectorPolicyDenied,
	ConnectorProviderFailed,
	ConnectorRequestCancelled,
	ConnectorSessionRequired,
} from "./errors";
import type {
	ActionDefinition,
	ActionGuideResponse,
	ActionSideEffect,
	ActionSummary,
	AgentActionPolicy,
	ApprovalPreview,
	AppSummary,
	ConnectionRecord,
	ConnectionSummary,
	ConnectorPolicy,
	ConnectorService,
	ExecuteActionInput,
	ExecuteActionResponse,
	GetActionGuideInput,
	HealthResponse,
	JsonObject,
	JsonSchema,
	ListAppsResponse,
	ListConnectionsResponse,
	ProviderAdapter,
	RequestContext,
	SearchActionsInput,
	SearchActionsResponse,
} from "./types";

interface PendingApproval {
	readonly actionId: string;
	readonly connectionAlias: string;
	readonly sessionId: string;
	readonly inputHash: string;
	readonly expiresAt: number;
}

export interface MemoryConnectorServiceOptions {
	readonly adapters: readonly ProviderAdapter[];
	readonly connections: readonly ConnectionRecord[];
	readonly credentials?: Readonly<Record<string, Readonly<Record<string, string>>>>;
	readonly policy?: ConnectorPolicy;
	readonly now?: () => number;
}

export class MemoryConnectorService implements ConnectorService {
	readonly #adapters: readonly ProviderAdapter[];
	readonly #actions: ReadonlyMap<string, ActionDefinition>;
	#connections: readonly ConnectionRecord[];
	#credentials: Readonly<Record<string, Readonly<Record<string, string>>>>;
	#policy: ConnectorPolicy;
	readonly #now: () => number;
	readonly #approvals = new Map<string, PendingApproval>();

	constructor(options: MemoryConnectorServiceOptions) {
		this.#adapters = [...options.adapters];
		this.#connections = [...options.connections];
		this.#credentials = options.credentials ?? {};
		this.#policy = options.policy ?? {};
		this.#now = options.now ?? Date.now;
		const actions = new Map<string, ActionDefinition>();
		for (const adapter of this.#adapters) {
			for (const action of adapter.actions) {
				const actionId = fullActionId(action);
				if (actions.has(actionId)) throw new Error(`Duplicate Connector Action: ${actionId}`);
				actions.set(actionId, action);
			}
		}
		this.#actions = actions;
	}

	/** Refreshes policy, connection aliases and credentials without replacing the Provider registry. */
	applyConfiguration(source: MemoryConnectorService): void {
		this.#connections = source.#connections;
		this.#credentials = source.#credentials;
		this.#policy = source.#policy;
	}

	async listApps(_context: RequestContext): Promise<ResultType<ListAppsResponse, never>> {
		const apps: AppSummary[] = this.#adapters.map((adapter) => ({
			providerId: adapter.definition.id,
			displayName: adapter.definition.displayName,
			description: adapter.definition.description,
			categories: adapter.definition.categories ?? [],
			authTypes: adapter.definition.authTypes,
			enabled: !this.#isProviderDisabled(adapter.definition.id),
			actionCount: adapter.actions.length,
			connectionCount: this.#connections.filter((connection) => connection.providerId === adapter.definition.id)
				.length,
		}));
		return Result.ok({ apps });
	}

	async listConnections(_context: RequestContext): Promise<ResultType<ListConnectionsResponse, never>> {
		const connections: ConnectionSummary[] = this.#connections.map((connection) => ({ ...connection }));
		return Result.ok({ connections });
	}

	async searchActions(
		input: SearchActionsInput,
		_context: RequestContext,
	): Promise<ResultType<SearchActionsResponse, never>> {
		const query = input.query?.trim().toLowerCase();
		const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
		const actions: ActionSummary[] = [];
		for (const action of this.#actions.values()) {
			if (this.#isProviderDisabled(action.providerId)) continue;
			const policy = this.#policyFor(action);
			if (policy === "hidden" || policy === "blocked") continue;
			if (input.providerId && input.providerId !== action.providerId) continue;
			if (input.sideEffect && input.sideEffect !== action.sideEffect) continue;
			if (query && !`${fullActionId(action)} ${action.description}`.toLowerCase().includes(query)) continue;
			actions.push({
				actionId: fullActionId(action),
				providerId: action.providerId,
				description: action.description,
				policy,
				sideEffect: action.sideEffect,
				dataSensitivity: action.dataSensitivity,
				requiredScopes: action.requiredScopes,
				requiresGuide: true,
			});
		}
		return Result.ok({ actions: actions.slice(0, limit), nextCursor: null });
	}

	async getActionGuide(
		input: GetActionGuideInput,
		_context: RequestContext,
	): Promise<ResultType<ActionGuideResponse, ConnectorActionNotFound | ConnectorPolicyDenied>> {
		const action = this.#actions.get(input.actionId);
		if (!action)
			return Result.err(
				new ConnectorActionNotFound({
					message: "Connector Action was not found",
					data: { actionId: input.actionId },
				}),
			);
		const policy = this.#policyFor(action);
		if (policy === "hidden" || policy === "blocked") {
			return Result.err(
				new ConnectorPolicyDenied({
					message: "Connector Action is not available to Agent discovery",
					data: { actionId: input.actionId, policy },
				}),
			);
		}
		return Result.ok({
			action,
			policy,
			...(input.connectionAlias ? { connectionAlias: input.connectionAlias } : {}),
		});
	}

	async executeAction(
		input: ExecuteActionInput,
		context: RequestContext,
	): Promise<ResultType<ExecuteActionResponse, import("./types").ConnectorFailure>> {
		if (context.signal?.aborted)
			return Result.err(
				new ConnectorRequestCancelled({
					message: "Connector request was cancelled",
					data: { requestId: context.requestId },
				}),
			);
		const action = this.#actions.get(input.actionId);
		if (!action)
			return Result.err(
				new ConnectorActionNotFound({
					message: "Connector Action was not found",
					data: { actionId: input.actionId },
				}),
			);
		const policy = this.#policyFor(action);
		if (policy === "hidden" || policy === "blocked") {
			return Result.err(
				new ConnectorPolicyDenied({
					message: "Connector Action is not executable",
					data: { actionId: input.actionId, policy },
				}),
			);
		}
		const connection = this.#resolveConnection(action.providerId, input.connectionAlias);
		if (connection.isErr()) return connection;
		if (connection.value.status !== "connected") {
			return Result.err(
				new ConnectorConnectionUnavailable({
					message: "Connector Connection is not available",
					data: { alias: connection.value.alias, status: connection.value.status },
				}),
			);
		}
		for (const requiredScope of action.requiredScopes) {
			if (!connection.value.scopes.includes(requiredScope)) {
				return Result.err(
					new ConnectorConnectionUnavailable({
						message: `Connector Connection is missing scope ${requiredScope}`,
						data: { alias: connection.value.alias, status: "missing_scope" },
					}),
				);
			}
		}
		const inputError = validateJsonSchema(action.inputSchema, input.input, "input");
		if (inputError)
			return Result.err(
				new ConnectorInputInvalid({
					message: "Connector Action input is invalid",
					data: { actionId: input.actionId, reason: inputError },
				}),
			);

		if (policy === "confirm") {
			if (!context.sessionId)
				return Result.err(
					new ConnectorSessionRequired({
						message: "A session is required for approval-gated Actions",
						data: { actionId: input.actionId },
					}),
				);
			const approval = this.#consumeApproval(input, context, connection.value);
			if (approval.isErr()) {
				if (!input.approvalId) {
					const approvalId = randomUUID();
					const expiresAt = this.#now() + 5 * 60_000;
					this.#approvals.set(approvalId, {
						actionId: input.actionId,
						connectionAlias: connection.value.alias,
						sessionId: context.sessionId,
						inputHash: hashInput(input.input),
						expiresAt,
					});
					const preview: ApprovalPreview = {
						actionId: input.actionId,
						connectionAlias: connection.value.alias,
						description: action.description,
						sideEffect: action.sideEffect,
						dataSensitivity: action.dataSensitivity,
						inputKeys: Object.keys(input.input).sort(),
						expiresAt,
					};
					return Result.ok({
						status: "approval_required",
						actionId: input.actionId,
						approvalId,
						approval: preview,
					});
				}
				return approval;
			}
		}

		const adapter = this.#adapters.find((candidate) => candidate.definition.id === action.providerId);
		if (!adapter)
			return Result.err(
				new ConnectorActionNotFound({
					message: "Provider Adapter was not found",
					data: { actionId: input.actionId },
				}),
			);
		try {
			const output = await adapter.execute(action, input.input, {
				requestId: context.requestId,
				sessionId: context.sessionId ?? "anonymous",
				connection: connection.value,
				credentials: this.#credentials[credentialKey(connection.value)] ?? {},
				signal: context.signal,
			});
			if (output.isErr()) return output;
			return Result.ok({ status: "completed", actionId: input.actionId, output: output.value });
		} catch (cause) {
			return Result.err(
				new ConnectorProviderFailed({
					message: "Provider Action execution failed",
					data: { providerId: action.providerId, actionId: action.actionId },
					cause,
				}),
			);
		}
	}

	async health(_context: RequestContext): Promise<ResultType<HealthResponse, never>> {
		return Result.ok({
			status: "ready",
			protocolVersion: 1,
			providerCount: this.#adapters.length,
			actionCount: this.#actions.size,
		});
	}

	#resolveConnection(providerId: string, alias?: string): ResultType<ConnectionRecord, ConnectorConnectionNotFound> {
		const connection = this.#connections.find(
			(candidate) => candidate.providerId === providerId && (alias === undefined ? true : candidate.alias === alias),
		);
		if (!connection)
			return Result.err(
				new ConnectorConnectionNotFound({
					message: "Connector Connection was not found",
					data: { providerId, ...(alias ? { alias } : {}) },
				}),
			);
		return Result.ok(connection);
	}

	#consumeApproval(
		input: ExecuteActionInput,
		context: RequestContext,
		connection: ConnectionRecord,
	): ResultType<true, ConnectorApprovalInvalid> {
		if (!input.approvalId)
			return Result.err(
				new ConnectorApprovalInvalid({
					message: "Approval is required",
					data: { actionId: input.actionId, reason: "missing" },
				}),
			);
		const approval = this.#approvals.get(input.approvalId);
		if (!approval)
			return Result.err(
				new ConnectorApprovalInvalid({
					message: "Approval was already consumed or not found",
					data: { actionId: input.actionId, reason: "replayed" },
				}),
			);
		this.#approvals.delete(input.approvalId);
		if (approval.expiresAt <= this.#now())
			return Result.err(
				new ConnectorApprovalInvalid({
					message: "Approval has expired",
					data: { actionId: input.actionId, reason: "expired" },
				}),
			);
		if (
			approval.actionId !== input.actionId ||
			approval.connectionAlias !== connection.alias ||
			approval.sessionId !== context.sessionId ||
			approval.inputHash !== hashInput(input.input)
		) {
			return Result.err(
				new ConnectorApprovalInvalid({
					message: "Approval does not match this execution",
					data: { actionId: input.actionId, reason: "mismatch" },
				}),
			);
		}
		return Result.ok(true);
	}

	#policyFor(action: ActionDefinition): AgentActionPolicy {
		const actionId = fullActionId(action);
		if (this.#isProviderDisabled(action.providerId)) return "hidden";
		if (action.dataSensitivity === "secret") return "hidden";
		if (matchesPattern(this.#policy.blocked, actionId)) return "blocked";
		if (matchesPattern(this.#policy.hidden, actionId)) return "hidden";
		if (matchesPattern(this.#policy.confirm, actionId)) return "confirm";
		if (action.defaultPolicy) return enforcePolicyFloor(action.sideEffect, action.defaultPolicy);
		if (this.#policy.default) return enforcePolicyFloor(action.sideEffect, this.#policy.default);
		return action.sideEffect === "read" ? "query" : "confirm";
	}

	#isProviderDisabled(providerId: string): boolean {
		return this.#policy.disabledProviders?.includes(providerId) ?? false;
	}
}

function enforcePolicyFloor(sideEffect: ActionSideEffect, policy: AgentActionPolicy): AgentActionPolicy {
	if (policy === "query" && sideEffect !== "read") return "confirm";
	return policy;
}

export function fullActionId(action: Pick<ActionDefinition, "providerId" | "actionId">): string {
	return `${action.providerId}.${action.actionId}`;
}

function matchesPattern(patterns: readonly string[] | undefined, actionId: string): boolean {
	return (
		patterns?.some((pattern) =>
			pattern.endsWith("*") ? actionId.startsWith(pattern.slice(0, -1)) : pattern === actionId,
		) ?? false
	);
}

function hashInput(input: JsonObject): string {
	return createHash("sha256").update(stableJson(input)).digest("hex");
}

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value as Record<string, unknown>)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function credentialKey(connection: ConnectionRecord): string {
	return `${connection.providerId}:${connection.alias}`;
}

function validateJsonSchema(schema: JsonSchema, value: unknown, path: string): string | undefined {
	if (schema.enum && !schema.enum.some((candidate) => stableJson(candidate) === stableJson(value)))
		return `${path} must be one of the declared enum values`;
	if (schema.type === "object") {
		if (!value || typeof value !== "object" || Array.isArray(value)) return `${path} must be an object`;
		const record = value as Record<string, unknown>;
		for (const key of schema.required ?? []) if (!(key in record)) return `${path}.${key} is required`;
		if (schema.additionalProperties === false) {
			for (const key of Object.keys(record)) if (!schema.properties?.[key]) return `${path}.${key} is not allowed`;
		}
		for (const [key, property] of Object.entries(schema.properties ?? {})) {
			if (key in record) {
				const error = validateJsonSchema(property, record[key], `${path}.${key}`);
				if (error) return error;
			}
		}
		return undefined;
	}
	if (schema.type === "array") {
		if (!Array.isArray(value)) return `${path} must be an array`;
		for (const [index, item] of value.entries()) {
			const error = schema.items ? validateJsonSchema(schema.items, item, `${path}[${index}]`) : undefined;
			if (error) return error;
		}
		return undefined;
	}
	if (schema.type === "string" && typeof value !== "string") return `${path} must be a string`;
	if (schema.type === "number" && (typeof value !== "number" || !Number.isFinite(value)))
		return `${path} must be a number`;
	if (schema.type === "integer" && (typeof value !== "number" || !Number.isInteger(value)))
		return `${path} must be an integer`;
	if (schema.type === "boolean" && typeof value !== "boolean") return `${path} must be a boolean`;
	if (schema.type === "null" && value !== null) return `${path} must be null`;
	if (schema.type === "string" && typeof value === "string") {
		if (schema.minLength !== undefined && value.length < schema.minLength) return `${path} is shorter than minLength`;
		if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} is longer than maxLength`;
	}
	return undefined;
}
