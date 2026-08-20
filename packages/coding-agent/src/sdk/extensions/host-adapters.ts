import { Value } from "@sinclair/typebox/value";
import { Result, type Result as ResultType } from "better-result";
import type { JsonObject } from "../../core/json";
import {
	CodingExtensionApprovalAborted,
	CodingExtensionConfigurationUnavailable,
	type CodingExtensionError,
	CodingExtensionPersistentApprovalUnavailable,
	CodingExtensionSessionStateUnavailable,
	extensionContractViolation,
} from "../extension-errors";
import type {
	CodingAgentExtension,
	CodingExtensionApprovalDecision,
	CodingExtensionApprovalRequest,
	CodingExtensionConfigurationStore,
	CodingExtensionContext,
	CodingExtensionRuntimeAdapter,
	CodingExtensionSessionStateAdapter,
	CodingExtensionSessionStateStore,
} from "./contract";

export async function extensionContext<TConfig extends JsonObject, TState extends JsonObject>(
	extension: CodingAgentExtension<TConfig, TState>,
	context: Omit<CodingExtensionContext, "configuration" | "sessionState" | "requestApproval">,
	runtime: CodingExtensionRuntimeAdapter | undefined,
	sessionState: CodingExtensionSessionStateAdapter | undefined,
): Promise<ResultType<CodingExtensionContext<TConfig, TState>, CodingExtensionError>> {
	return Result.gen(async function* () {
		const configuration = yield* Result.await(extensionConfiguration(extension, runtime));
		const state = yield* Result.await(extensionSessionState(extension, sessionState));
		return Result.ok({
			...context,
			configuration,
			sessionState: state,
			requestApproval: async (request: CodingExtensionApprovalRequest, signal?: AbortSignal) => {
				const valid = assertExtensionApprovalRequest(extension.id, context.sessionId, request);
				if (valid.isErr()) return valid;
				if (signal?.aborted) {
					return Result.err(
						new CodingExtensionApprovalAborted({
							extensionId: extension.id,
							message: "Extension approval was aborted",
						}),
					);
				}
				const requested = runtime?.requestApproval
					? await runtime.requestApproval(structuredClone(request), signal)
					: Result.ok<CodingExtensionApprovalDecision, CodingExtensionError>("deny");
				if (requested.isErr()) return requested;
				const decision = requested.value;
				if (decision !== "deny" && decision !== "allowOnce" && decision !== "allow") {
					return Result.err(
						extensionContractViolation({
							extensionId: extension.id,
							message: "Extension approval handler returned an invalid decision",
						}),
					);
				}
				if (decision === "allow" && !configuration.persistent) {
					return Result.err(
						new CodingExtensionPersistentApprovalUnavailable({
							extensionId: extension.id,
							message: `Extension "${extension.id}" cannot persist an allow decision`,
						}),
					);
				}
				return Result.ok(decision);
			},
		});
	});
}

async function extensionConfiguration<TConfig extends JsonObject, TState extends JsonObject>(
	extension: CodingAgentExtension<TConfig, TState>,
	runtime: CodingExtensionRuntimeAdapter | undefined,
): Promise<ResultType<CodingExtensionConfigurationStore<TConfig>, CodingExtensionError>> {
	const declaration = extension.configuration;
	if (!declaration) return Result.ok(unavailableConfiguration<TConfig>(extension.id));
	if (!Value.Check(declaration.schema, declaration.defaultValue)) {
		return Result.err(
			extensionContractViolation({
				extensionId: extension.id,
				message: `Extension "${extension.id}" declared an invalid default configuration`,
			}),
		);
	}
	const loaded = runtime?.readConfiguration
		? await runtime.readConfiguration({ extensionId: extension.id, scope: declaration.scope })
		: Result.ok<JsonObject | undefined, CodingExtensionError>(undefined);
	if (loaded.isErr()) return loaded;
	if (loaded.value !== undefined && !Value.Check(declaration.schema, loaded.value)) {
		return Result.err(
			extensionContractViolation({
				extensionId: extension.id,
				message: `Extension "${extension.id}" configuration is invalid`,
			}),
		);
	}
	let value = structuredClone((loaded.value ?? declaration.defaultValue) as TConfig);
	const persistent = Boolean(runtime?.writeConfiguration);
	return Result.ok({
		get value() {
			return structuredClone(value);
		},
		persistent,
		async update(next) {
			if (!runtime?.writeConfiguration) {
				return Result.err(
					new CodingExtensionConfigurationUnavailable({
						extensionId: extension.id,
						message: `Extension "${extension.id}" configuration cannot be persisted by this host`,
					}),
				);
			}
			if (!Value.Check(declaration.schema, next)) {
				return Result.err(
					extensionContractViolation({
						extensionId: extension.id,
						message: `Extension "${extension.id}" attempted to persist invalid configuration`,
					}),
				);
			}
			const persisted = await runtime.writeConfiguration({
				extensionId: extension.id,
				scope: declaration.scope,
				value: structuredClone(next),
			});
			if (persisted.isErr()) return persisted;
			if (!Value.Check(declaration.schema, persisted.value)) {
				return Result.err(
					extensionContractViolation({
						extensionId: extension.id,
						message: `Host persisted invalid configuration for extension "${extension.id}"`,
					}),
				);
			}
			value = structuredClone(persisted.value as TConfig);
			return Result.ok(structuredClone(value));
		},
	});
}

async function extensionSessionState<TConfig extends JsonObject, TState extends JsonObject>(
	extension: CodingAgentExtension<TConfig, TState>,
	adapter: CodingExtensionSessionStateAdapter | undefined,
): Promise<ResultType<CodingExtensionSessionStateStore<TState>, CodingExtensionError>> {
	const declaration = extension.sessionState;
	if (!declaration) return Result.ok(unavailableSessionState<TState>(extension.id));
	if (!Value.Check(declaration.schema, declaration.defaultValue)) {
		return Result.err(
			extensionContractViolation({
				extensionId: extension.id,
				message: `Extension "${extension.id}" declared invalid default session state`,
			}),
		);
	}
	if (!adapter) {
		return Result.err(
			new CodingExtensionSessionStateUnavailable({
				extensionId: extension.id,
				message: `Extension "${extension.id}" session state is unavailable`,
			}),
		);
	}
	const loaded = await adapter.read(extension.id);
	if (loaded.isErr()) return loaded;
	if (loaded.value !== undefined && !Value.Check(declaration.schema, loaded.value)) {
		return Result.err(
			extensionContractViolation({
				extensionId: extension.id,
				message: `Extension "${extension.id}" session state is invalid`,
			}),
		);
	}
	let value = structuredClone((loaded.value ?? declaration.defaultValue) as TState);
	return Result.ok({
		get value() {
			return structuredClone(value);
		},
		async update(update) {
			const persisted = await adapter.update(extension.id, (stored) => {
				const current = structuredClone((stored ?? declaration.defaultValue) as TState);
				if (!Value.Check(declaration.schema, current)) {
					return Result.err(
						extensionContractViolation({
							extensionId: extension.id,
							message: `Extension "${extension.id}" session state is invalid`,
						}),
					);
				}
				const next = update(current);
				if (!Value.Check(declaration.schema, next)) {
					return Result.err(
						extensionContractViolation({
							extensionId: extension.id,
							message: `Extension "${extension.id}" attempted to persist invalid session state`,
						}),
					);
				}
				return Result.ok(structuredClone(next));
			});
			if (persisted.isErr()) return persisted;
			if (!Value.Check(declaration.schema, persisted.value)) {
				return Result.err(
					extensionContractViolation({
						extensionId: extension.id,
						message: `Host persisted invalid session state for extension "${extension.id}"`,
					}),
				);
			}
			value = structuredClone(persisted.value as TState);
			return Result.ok(structuredClone(value));
		},
	});
}

function unavailableConfiguration<TConfig extends JsonObject>(
	extensionId: string,
): CodingExtensionConfigurationStore<TConfig> {
	return {
		value: {} as TConfig,
		persistent: false,
		update: async () =>
			Result.err(
				new CodingExtensionConfigurationUnavailable({
					extensionId,
					message: `Extension "${extensionId}" did not declare persistent configuration`,
				}),
			),
	};
}

function unavailableSessionState<TState extends JsonObject>(
	extensionId: string,
): CodingExtensionSessionStateStore<TState> {
	return {
		value: {} as TState,
		update: async () =>
			Result.err(
				new CodingExtensionSessionStateUnavailable({
					extensionId,
					message: `Extension "${extensionId}" did not declare session state`,
				}),
			),
	};
}

function assertExtensionApprovalRequest(
	extensionId: string,
	sessionId: string,
	request: CodingExtensionApprovalRequest,
): ResultType<void, CodingExtensionError> {
	if (
		request.extensionId !== extensionId ||
		request.sessionId !== sessionId ||
		!request.requestId.trim() ||
		!request.operationId.trim() ||
		!request.reason.trim() ||
		!request.presentation.title.trim()
	) {
		return Result.err(
			extensionContractViolation({
				extensionId,
				message: `Extension "${extensionId}" produced an invalid approval request`,
			}),
		);
	}
	return Result.ok(undefined);
}
