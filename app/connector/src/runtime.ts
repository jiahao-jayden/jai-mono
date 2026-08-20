import { randomUUID } from "node:crypto";
import { Result, type Result as ResultType } from "better-result";
import {
	ConnectorActionNotFound,
	ConnectorConnectionNotFound,
	ConnectorConnectionUnavailable,
	ConnectorInputInvalid,
	ConnectorPolicyDenied,
	ConnectorPreparationInvalid,
	ConnectorRequestCancelled,
	ConnectorUpstreamFailed,
} from "./errors";
import type {
	ActionDefinition,
	ActionGuideResponse,
	ActionSummary,
	AppSummary,
	ConnectionRecord,
	ConnectionSummary,
	ConnectorActionPermission,
	ConnectorAdapter,
	ConnectorPolicy,
	ConnectorService,
	ExecuteActionResponse,
	GetActionGuideInput,
	HealthResponse,
	JsonObject,
	JsonSchema,
	ListAppsResponse,
	ListConnectionsResponse,
	PrepareActionInput,
	PreparedConnectorAction,
	RequestContext,
	SearchActionsInput,
	SearchActionsResponse,
} from "./types";

interface PreparedAction {
	readonly adapter: ConnectorAdapter;
	readonly action: ActionDefinition;
	readonly connection: ConnectionRecord;
	readonly credentials: Readonly<Record<string, string>>;
	readonly input: JsonObject;
	readonly requestId: string;
	readonly actionId: string;
	readonly approvalMode: Exclude<ConnectorActionPermission, "deny">;
	readonly expiresAt: number;
}

const preparedActionLifetimeMs = 5 * 60_000;

export interface MemoryConnectorServiceOptions {
	readonly adapters: readonly ConnectorAdapter[];
	readonly connections: readonly ConnectionRecord[];
	readonly credentials?: Readonly<Record<string, Readonly<Record<string, string>>>>;
	readonly policy?: ConnectorPolicy;
}

export class MemoryConnectorService implements ConnectorService {
	readonly #adapters: readonly ConnectorAdapter[];
	readonly #actions: ReadonlyMap<string, ActionDefinition>;
	#connections: readonly ConnectionRecord[];
	#credentials: Readonly<Record<string, Readonly<Record<string, string>>>>;
	#policy: ConnectorPolicy;
	readonly #preparedActions = new Map<string, PreparedAction>();

	constructor(options: MemoryConnectorServiceOptions) {
		this.#adapters = [...options.adapters];
		this.#connections = [...options.connections];
		this.#credentials = options.credentials ?? {};
		this.#policy = options.policy ?? {};
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

	/** Refreshes policy, connections and credentials without replacing the Connector registry. */
	applyConfiguration(source: MemoryConnectorService): void {
		this.#connections = source.#connections;
		this.#credentials = source.#credentials;
		this.#policy = source.#policy;
	}

	async listApps(_context: RequestContext): Promise<ResultType<ListAppsResponse, never>> {
		const apps: AppSummary[] = this.#adapters.map((adapter) => ({
			connectorId: adapter.definition.id,
			displayName: adapter.definition.displayName,
			description: adapter.definition.description,
			categories: adapter.definition.categories ?? [],
			authTypes: adapter.definition.authTypes,
			enabled: !this.#isConnectorDisabled(adapter.definition.id),
			actionCount: adapter.actions.length,
			connectionCount: this.#connections.filter((connection) => connection.connectorId === adapter.definition.id)
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
			if (this.#isConnectorDisabled(action.connectorId)) continue;
			const policy = this.#policyFor(action);
			if (this.#isActionHidden(action)) continue;
			if (input.connectorId && input.connectorId !== action.connectorId) continue;
			if (input.sideEffect && input.sideEffect !== action.sideEffect) continue;
			if (query && !`${fullActionId(action)} ${action.description}`.toLowerCase().includes(query)) continue;
			actions.push({
				actionId: fullActionId(action),
				connectorId: action.connectorId,
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
		if (this.#isActionHidden(action)) {
			return Result.err(
				new ConnectorPolicyDenied({
					message: "Connector Action is not available to Agent discovery",
					data: { actionId: input.actionId, policy: "hidden" },
				}),
			);
		}
		return Result.ok({
			action,
			policy,
		});
	}

	async prepareAction(
		input: PrepareActionInput,
		context: RequestContext,
	): Promise<ResultType<PreparedConnectorAction, import("./types").ConnectorFailure>> {
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
		if (this.#isActionHidden(action)) {
			return Result.err(
				new ConnectorPolicyDenied({
					message: "Connector Action is not executable",
					data: { actionId: input.actionId, policy: "hidden" },
				}),
			);
		}
		if (policy === "deny") {
			return Result.err(
				new ConnectorPolicyDenied({
					message: "Connector Action is denied by Connector permissions",
					data: { actionId: input.actionId, policy: "deny" },
				}),
			);
		}
		const connection = this.#resolveConnection(action.connectorId);
		if (connection.isErr()) return connection;
		if (connection.value.status !== "connected") {
			return Result.err(
				new ConnectorConnectionUnavailable({
					message: "Connector Connection is not available",
					data: { connectorId: connection.value.connectorId, status: connection.value.status },
				}),
			);
		}
		for (const requiredScope of action.requiredScopes) {
			if (!connection.value.scopes.includes(requiredScope)) {
				return Result.err(
					new ConnectorConnectionUnavailable({
						message: `Connector Connection is missing scope ${requiredScope}`,
						data: { connectorId: connection.value.connectorId, status: "missing_scope" },
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

		const adapter = this.#adapters.find((candidate) => candidate.definition.id === action.connectorId);
		if (!adapter)
			return Result.err(
				new ConnectorActionNotFound({
					message: "Connector Adapter was not found",
					data: { actionId: input.actionId },
				}),
			);
		const preparationId = randomUUID();
		const expiresAt = Date.now() + preparedActionLifetimeMs;
		this.#preparedActions.set(preparationId, {
			adapter,
			action,
			connection: connection.value,
			credentials: this.#credentials[credentialKey(connection.value)] ?? {},
			input: structuredClone(input.input),
			requestId: context.requestId,
			actionId: input.actionId,
			approvalMode: policy,
			expiresAt,
		});
		return Result.ok({
			preparationId,
			actionId: input.actionId,
			description: action.description,
			sideEffect: action.sideEffect,
			dataSensitivity: action.dataSensitivity,
			approvalMode: policy,
			expiresAt,
		});
	}

	async executePreparedAction(
		prepared: PreparedConnectorAction,
		context: RequestContext,
	): Promise<ResultType<ExecuteActionResponse, import("./types").ConnectorFailure>> {
		if (context.signal?.aborted)
			return Result.err(
				new ConnectorRequestCancelled({
					message: "Connector request was cancelled",
					data: { requestId: context.requestId },
				}),
			);
		const pending = this.#preparedActions.get(prepared.preparationId);
		if (!pending)
			return Result.err(
				new ConnectorPreparationInvalid({
					message: "Connector Action preparation was not found",
					data: { preparationId: prepared.preparationId, reason: "missing" },
				}),
			);
		if (
			pending.requestId !== context.requestId ||
			pending.actionId !== prepared.actionId ||
			pending.action.description !== prepared.description ||
			pending.action.sideEffect !== prepared.sideEffect ||
			pending.action.dataSensitivity !== prepared.dataSensitivity ||
			pending.approvalMode !== prepared.approvalMode ||
			pending.expiresAt !== prepared.expiresAt
		) {
			return Result.err(
				new ConnectorPreparationInvalid({
					message: "Connector Action preparation does not match this execution",
					data: { preparationId: prepared.preparationId, reason: "mismatch" },
				}),
			);
		}
		this.#preparedActions.delete(prepared.preparationId);
		if (pending.expiresAt <= Date.now()) {
			return Result.err(
				new ConnectorPreparationInvalid({
					message: "Connector Action preparation expired",
					data: { preparationId: prepared.preparationId, reason: "expired" },
				}),
			);
		}
		try {
			const output = await pending.adapter.execute(pending.action, pending.input, {
				requestId: context.requestId,
				sessionId: context.sessionId ?? "anonymous",
				connection: pending.connection,
				credentials: pending.credentials,
				signal: context.signal,
			});
			if (output.isErr()) return output;
			return Result.ok({ status: "completed", actionId: pending.actionId, output: output.value });
		} catch (cause) {
			return Result.err(
				new ConnectorUpstreamFailed({
					message: "Connector Action execution failed",
					data: { connectorId: pending.action.connectorId, actionId: pending.action.actionId },
					cause,
				}),
			);
		}
	}

	async discardPreparedAction(
		prepared: PreparedConnectorAction,
		context: RequestContext,
	): Promise<ResultType<void, import("./types").ConnectorFailure>> {
		const pending = this.#preparedActions.get(prepared.preparationId);
		if (!pending)
			return Result.err(
				new ConnectorPreparationInvalid({
					message: "Connector Action preparation was not found",
					data: { preparationId: prepared.preparationId, reason: "missing" },
				}),
			);
		if (pending.requestId !== context.requestId || pending.actionId !== prepared.actionId) {
			return Result.err(
				new ConnectorPreparationInvalid({
					message: "Connector Action preparation does not match this request",
					data: { preparationId: prepared.preparationId, reason: "mismatch" },
				}),
			);
		}
		this.#preparedActions.delete(prepared.preparationId);
		return Result.ok(undefined);
	}

	async health(_context: RequestContext): Promise<ResultType<HealthResponse, never>> {
		return Result.ok({
			status: "ready",
			protocolVersion: 1,
			connectorCount: this.#adapters.length,
			actionCount: this.#actions.size,
		});
	}

	#resolveConnection(connectorId: string): ResultType<ConnectionRecord, ConnectorConnectionNotFound> {
		const connection = this.#connections.find((candidate) => candidate.connectorId === connectorId);
		if (!connection)
			return Result.err(
				new ConnectorConnectionNotFound({
					message: "Connector Connection was not found",
					data: { connectorId },
				}),
			);
		return Result.ok(connection);
	}

	#policyFor(action: ActionDefinition): ConnectorActionPermission {
		return this.#policy.actions?.[fullActionId(action)] ?? this.#policy.default ?? "ask";
	}

	#isConnectorDisabled(connectorId: string): boolean {
		return this.#policy.disabledConnectors?.includes(connectorId) ?? false;
	}

	#isActionHidden(action: ActionDefinition): boolean {
		return this.#isConnectorDisabled(action.connectorId) || action.dataSensitivity === "secret";
	}
}

export function fullActionId(action: Pick<ActionDefinition, "connectorId" | "actionId">): string {
	return `${action.connectorId}.${action.actionId}`;
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
	return connection.connectorId;
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
