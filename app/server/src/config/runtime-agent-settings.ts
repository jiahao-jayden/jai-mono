import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { AnthropicProvider, OpenAIProvider, OpenAIResponsesProvider, type Provider } from "@jai/ai";
import type { CodingProviderOptions, JsonObject } from "@jai/coding-agent";
import { Result, type Result as ResultType, TaggedError } from "better-result";

export type RuntimeProviderAdapter = "anthropic" | "openai-compatible" | "openai-responses";
export type RuntimeProviderAuthentication = "api-key" | "none";
export type RuntimeReasoningEffort = "low" | "medium" | "high";

/** Durable, non-secret model selection inside a configured Provider profile. */
export interface RuntimeProviderModel {
	readonly id: string;
	readonly remoteModelId?: string;
	readonly enabled: boolean;
}

/** The last explicit model discovery result for one Provider connection. */
export interface RuntimeProviderModelInventory {
	readonly modelIds: readonly string[];
	readonly fetchedAt: number;
}

/** Durable, Server-owned Provider credentials and connection policy. */
export interface RuntimeProviderProfile {
	readonly name: string;
	readonly adapter: RuntimeProviderAdapter;
	readonly baseURL?: string;
	readonly authentication: RuntimeProviderAuthentication;
	readonly apiKey?: string;
	readonly headers?: Readonly<Record<string, string>>;
	readonly enabled: boolean;
	readonly models: Readonly<Record<string, RuntimeProviderModel>>;
	readonly modelInventory?: RuntimeProviderModelInventory;
}

export type RuntimeConnectorPermission = "ask" | "allow" | "deny";

export interface RuntimeConnectorSettings {
	readonly policy?: {
		readonly default?: RuntimeConnectorPermission;
		readonly actions?: Readonly<Record<string, RuntimeConnectorPermission>>;
	};
	readonly connectors?: Readonly<
		Record<
			string,
			{
				readonly enabled?: boolean;
				readonly credentials?: Readonly<Record<string, string>>;
			}
		>
	>;
}

export interface RuntimeConnectorCredentialProjection {
	readonly key: string;
	readonly configured: boolean;
	readonly mask?: string;
}

export interface RuntimeConnectorProjection {
	readonly policy: {
		readonly default: RuntimeConnectorPermission;
		readonly actions: Readonly<Record<string, RuntimeConnectorPermission>>;
	};
	readonly connectors: readonly {
		readonly id: string;
		readonly enabled: boolean;
		readonly credentials: readonly RuntimeConnectorCredentialProjection[];
		readonly oauth?: {
			readonly connected: boolean;
			readonly scopes: readonly string[];
			readonly expiresAt?: number;
		};
	}[];
}

export interface RuntimeConnectorOAuthTokenInput {
	readonly connectorId: string;
	readonly accessToken: string;
	readonly tokenType: string;
	readonly refreshToken?: string;
	readonly expiresAt?: number;
	readonly scopes: readonly string[];
}

/**
 * Canonical product configuration used to assemble a Coding Agent. Secrets
 * stay in this Server-side fact; clients receive only a safe projection.
 */
export interface RuntimeAgentSettings {
	readonly model: string;
	readonly maxTurns?: number;
	readonly language?: string;
	readonly reasoningEffort?: RuntimeReasoningEffort;
	readonly providers: Readonly<Record<string, RuntimeProviderProfile>>;
	readonly extensions: Readonly<Record<string, JsonObject>>;
	readonly connector?: RuntimeConnectorSettings;
}

export interface RuntimeProviderProfileInput {
	readonly id: string;
	/** Renaming a profile keeps its credential and discovery inventory when its connection is unchanged. */
	readonly previousId?: string;
	readonly name: string;
	readonly adapter: RuntimeProviderAdapter;
	readonly baseURL?: string;
	readonly authentication: RuntimeProviderAuthentication;
	/** Omitted keeps a credential when the connection identity is unchanged. */
	readonly apiKey?: string;
	readonly clearApiKey?: boolean;
	readonly headers?: Readonly<Record<string, string>>;
	readonly enabled: boolean;
	readonly models: readonly RuntimeProviderModel[];
}

/** Safe client command: it intentionally has no connector or extension secrets. */
export interface RuntimeAgentSettingsInput {
	readonly revision: string | null;
	readonly model: string;
	readonly maxTurns?: number;
	readonly language?: string;
	readonly reasoningEffort?: RuntimeReasoningEffort;
	readonly providers: readonly RuntimeProviderProfileInput[];
	readonly connector?: RuntimeConnectorSettings;
}

export interface RuntimeProviderProfileProjection {
	readonly id: string;
	readonly name: string;
	readonly adapter: RuntimeProviderAdapter;
	readonly baseURL?: string;
	readonly authentication: RuntimeProviderAuthentication;
	readonly credentialConfigured: boolean;
	readonly credentialMask?: string;
	readonly enabled: boolean;
	readonly modelsFetchedAt?: number;
	readonly models: readonly RuntimeProviderModel[];
}

export interface RuntimeAgentSettingsModelFetchResult {
	readonly profileId: string;
	readonly modelCount: number;
	readonly fetchedAt: number;
	readonly snapshot: RuntimeAgentSettingsSnapshot;
}

/** Explicit whitelist DTO for local Desktop settings presentation. */
export interface RuntimeAgentSettingsSnapshot {
	/** null means the Host is ready to be configured but has no durable settings yet. */
	readonly revision: string | null;
	readonly model: string;
	readonly maxTurns?: number;
	readonly language?: string;
	readonly reasoningEffort?: RuntimeReasoningEffort;
	readonly profiles: readonly RuntimeProviderProfileProjection[];
	readonly connector: RuntimeConnectorProjection;
}

export interface ResolvedRuntimeAgentOptions {
	readonly model: string;
	readonly provider?: CodingProviderOptions;
	readonly maxTurns?: number;
	readonly instructions?: string;
	readonly providerOptions?: Record<string, Record<string, unknown>>;
}

export class RuntimeAgentSettingsMissing extends TaggedError("runtime_config.agent_settings_missing")<{
	readonly message: string;
}> {}

export class RuntimeAgentSettingsCorrupted extends TaggedError("runtime_config.agent_settings_corrupted")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class RuntimeAgentSettingsInvalid extends TaggedError("runtime_config.agent_settings_invalid")<{
	readonly message: string;
}> {}

export class RuntimeAgentSettingsWriteConflict extends TaggedError("runtime_config.agent_settings_write_conflict")<{
	readonly expectedRevision: string | null;
	readonly actualRevision: string | null;
	readonly message: string;
}> {}

export class RuntimeAgentSettingsModelFetchFailed extends TaggedError("runtime_config.model_fetch_failed")<{
	readonly profileId: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

export type RuntimeAgentSettingsReadError = RuntimeAgentSettingsMissing | RuntimeAgentSettingsCorrupted;
export type RuntimeAgentSettingsWriteError =
	| RuntimeAgentSettingsInvalid
	| RuntimeAgentSettingsWriteConflict
	| RuntimeAgentSettingsCorrupted;
export type RuntimeAgentSettingsModelFetchError =
	| RuntimeAgentSettingsMissing
	| RuntimeAgentSettingsInvalid
	| RuntimeAgentSettingsWriteConflict
	| RuntimeAgentSettingsCorrupted
	| RuntimeAgentSettingsModelFetchFailed;

const profileIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const modelIdPattern = /\S/;
const languagePattern = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const sensitiveHeaderPattern = /^(authorization|proxy-authorization|x-api-key)$/i;
const connectorOAuthCredentialKeys = new Set([
	"accessToken",
	"refreshToken",
	"tokenType",
	"expiresAt",
	"scopes",
	"oauthIntentId",
]);

/**
 * Deep Server module for Runtime Agent configuration. It owns validation,
 * secret preservation, optimistic writes, safe projection, and profile-to-SDK
 * resolution behind one SQLite row. No client receives a raw stored object.
 */
export class SqliteRuntimeAgentSettings {
	constructor(private readonly database: DatabaseSync) {
		this.database.exec(`
			CREATE TABLE IF NOT EXISTS runtime_agent_settings (
				key TEXT PRIMARY KEY CHECK (key = 'default'),
				settings_json TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
		`);
	}

	bootstrap(
		settings: RuntimeAgentSettings,
		now = new Date().toISOString(),
	): ResultType<void, RuntimeAgentSettingsInvalid | RuntimeAgentSettingsCorrupted> {
		const validated = validateSettings(settings);
		if (validated.isErr()) return Result.err(validated.error);
		try {
			this.database
				.prepare(
					`INSERT INTO runtime_agent_settings (key, settings_json, updated_at) VALUES ('default', ?, ?)
					 ON CONFLICT(key) DO NOTHING`,
				)
				.run(JSON.stringify(validated.value), now);
			return Result.ok(undefined);
		} catch (cause) {
			return Result.err(
				new RuntimeAgentSettingsCorrupted({
					message: "Could not bootstrap Runtime Agent settings",
					cause,
				}),
			);
		}
	}

	read(): ResultType<RuntimeAgentSettings, RuntimeAgentSettingsReadError> {
		const current = this.current();
		if (current.isErr()) return Result.err(current.error);
		return Result.ok(current.value.settings);
	}

	snapshot(): ResultType<RuntimeAgentSettingsSnapshot, RuntimeAgentSettingsCorrupted> {
		const current = this.current();
		if (current.isErr()) {
			if (current.error._tag === "runtime_config.agent_settings_missing") {
				return Result.ok({
					revision: null,
					model: "",
					profiles: [],
					connector: projectConnector(undefined),
				});
			}
			return Result.err(current.error);
		}
		return Result.ok(projectSnapshot(current.value.settings, current.value.revision));
	}

	write(
		input: RuntimeAgentSettingsInput,
		now = new Date().toISOString(),
	): ResultType<RuntimeAgentSettingsSnapshot, RuntimeAgentSettingsWriteError> {
		const parsed = parseRuntimeAgentSettingsInput(input);
		if (!parsed) {
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: "Runtime Agent settings input is invalid",
				}),
			);
		}
		const current = this.current();
		if (current.isErr()) {
			if (current.error._tag === "runtime_config.agent_settings_missing") {
				if (parsed.revision !== null) {
					return Result.err(
						new RuntimeAgentSettingsWriteConflict({
							message: "Runtime Agent settings were not configured at the requested revision",
							expectedRevision: parsed.revision,
							actualRevision: null,
						}),
					);
				}
				return this.insertInitial(parsed, now);
			}
			return Result.err(current.error);
		}
		if (parsed.revision !== current.value.revision) {
			return Result.err(
				new RuntimeAgentSettingsWriteConflict({
					message: "Runtime Agent settings changed before they could be saved",
					expectedRevision: parsed.revision,
					actualRevision: current.value.revision,
				}),
			);
		}
		const next = settingsFromInput(parsed, current.value.settings);
		if (next.isErr()) return Result.err(next.error);
		return this.persist(next.value, current.value.revision, now);
	}

	/**
	 * Discovers models through the Server-owned Provider connection, then commits
	 * the inventory into the same durable configuration fact. A Desktop process
	 * never opens the database or receives the credential used for this request.
	 */
	async fetchModels(
		profileId: string,
		now = Date.now(),
	): Promise<ResultType<RuntimeAgentSettingsModelFetchResult, RuntimeAgentSettingsModelFetchError>> {
		if (!profileIdPattern.test(profileId)) {
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: "Provider profile id is invalid",
				}),
			);
		}
		const current = this.current();
		if (current.isErr()) return Result.err(current.error);
		const profile = current.value.settings.providers[profileId];
		if (!profile) {
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: `Provider profile "${profileId}" is not configured`,
				}),
			);
		}
		if (!profile.enabled) {
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: `Provider profile "${profileId}" is disabled`,
				}),
			);
		}
		let modelIds: readonly string[];
		try {
			modelIds = await discoverModels(profileId, profile);
		} catch (cause) {
			return Result.err(
				new RuntimeAgentSettingsModelFetchFailed({
					message: `Could not fetch models for Provider profile "${profileId}"`,
					profileId,
					cause,
				}),
			);
		}
		const next: RuntimeAgentSettings = {
			...current.value.settings,
			providers: {
				...current.value.settings.providers,
				[profileId]: {
					...profile,
					modelInventory: {
						modelIds: uniqueModelIds(modelIds),
						fetchedAt: now,
					},
				},
			},
		};
		const persisted = this.persist(next, current.value.revision, new Date(now).toISOString());
		if (persisted.isErr()) return Result.err(persisted.error);
		return Result.ok({
			profileId,
			modelCount: next.providers[profileId]!.modelInventory!.modelIds.length,
			fetchedAt: now,
			snapshot: persisted.value,
		});
	}

	resolveOptions(
		model?: string,
	): ResultType<ResolvedRuntimeAgentOptions, RuntimeAgentSettingsReadError | RuntimeAgentSettingsInvalid> {
		const settings = this.read();
		if (settings.isErr()) return Result.err(settings.error);
		return resolveRuntimeAgentOptions({
			...settings.value,
			...(model === undefined ? {} : { model }),
		});
	}

	/**
	 * Returns the raw Connector settings only to Server-local runtime assembly.
	 * This deliberately has no client/protocol counterpart: OAuth tokens and API
	 * credentials must never leave the Runtime Host as a read model.
	 */
	readConnectorSettings(): ResultType<RuntimeConnectorSettings, RuntimeAgentSettingsReadError> {
		const settings = this.read();
		if (settings.isErr()) return Result.err(settings.error);
		return Result.ok(structuredClone(settings.value.connector ?? {}));
	}

	/**
	 * Persists the Connector Extension's policy slice while retaining every
	 * credential. The Extension receives only this policy projection, so its
	 * "always allow" action cannot observe or overwrite OAuth/API secrets.
	 */
	writeConnectorPolicy(
		policy: NonNullable<RuntimeConnectorSettings["policy"]>,
		now = new Date().toISOString(),
	): ResultType<
		RuntimeConnectorSettings,
		| RuntimeAgentSettingsReadError
		| RuntimeAgentSettingsInvalid
		| RuntimeAgentSettingsWriteConflict
		| RuntimeAgentSettingsCorrupted
	> {
		if (!isRuntimeConnectorPolicy(policy)) {
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: "Connector policy is invalid",
				}),
			);
		}
		const current = this.current();
		if (current.isErr()) return Result.err(current.error);
		const connector: RuntimeConnectorSettings = {
			...(current.value.settings.connector ?? {}),
			policy: structuredClone(policy),
		};
		const persisted = this.persist({ ...current.value.settings, connector }, current.value.revision, now);
		if (persisted.isErr()) return Result.err(persisted.error);
		return Result.ok(connector);
	}

	revealApiKey(
		profileId: string,
	): ResultType<
		{ readonly profileId: string; readonly apiKey: string },
		RuntimeAgentSettingsReadError | RuntimeAgentSettingsInvalid
	> {
		if (!profileIdPattern.test(profileId)) {
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: "Provider profile id is invalid",
				}),
			);
		}
		const settings = this.read();
		if (settings.isErr()) return Result.err(settings.error);
		const apiKey = settings.value.providers[profileId]?.apiKey;
		if (!apiKey) {
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: `Provider profile "${profileId}" has no saved API key`,
				}),
			);
		}
		return Result.ok({ profileId, apiKey });
	}

	saveConnectorOAuth(
		input: RuntimeConnectorOAuthTokenInput,
		now = new Date().toISOString(),
		options: { readonly oauthIntentId?: string } = {},
	): ResultType<
		RuntimeAgentSettingsSnapshot,
		| RuntimeAgentSettingsReadError
		| RuntimeAgentSettingsInvalid
		| RuntimeAgentSettingsWriteConflict
		| RuntimeAgentSettingsCorrupted
	> {
		if (!validConnectorOAuthToken(input)) {
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: "Connector OAuth token input is invalid",
				}),
			);
		}
		if (options.oauthIntentId !== undefined && !options.oauthIntentId.trim()) {
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: "Connector OAuth intent id is invalid",
				}),
			);
		}
		const current = this.current();
		if (current.isErr()) return Result.err(current.error);
		const connectors = current.value.settings.connector?.connectors ?? {};
		const connector = connectors[input.connectorId];
		const credentials = {
			...(connector?.credentials ?? {}),
			accessToken: input.accessToken,
			tokenType: input.tokenType,
			scopes: input.scopes.join(" "),
			...(input.refreshToken === undefined ? {} : { refreshToken: input.refreshToken }),
			...(input.expiresAt === undefined ? {} : { expiresAt: String(input.expiresAt) }),
			...(options.oauthIntentId === undefined ? {} : { oauthIntentId: options.oauthIntentId }),
		};
		return this.persist(
			{
				...current.value.settings,
				connector: {
					...(current.value.settings.connector ?? {}),
					connectors: {
						...connectors,
						[input.connectorId]: {
							...(connector ?? {}),
							enabled: connector?.enabled ?? true,
							credentials,
						},
					},
				},
			},
			current.value.revision,
			now,
		);
	}

	disconnectConnectorOAuth(
		connectorId: string,
		now = new Date().toISOString(),
	): ResultType<
		RuntimeAgentSettingsSnapshot,
		| RuntimeAgentSettingsReadError
		| RuntimeAgentSettingsInvalid
		| RuntimeAgentSettingsWriteConflict
		| RuntimeAgentSettingsCorrupted
	> {
		if (!connectorId.trim())
			return Result.err(new RuntimeAgentSettingsInvalid({ message: "Connector id is invalid" }));
		const current = this.current();
		if (current.isErr()) return Result.err(current.error);
		const connectors = current.value.settings.connector?.connectors ?? {};
		const connector = connectors[connectorId];
		const { credentials: _previousCredentials, ...connectorWithoutCredentials } = connector ?? {};
		const credentials = { ...(connector?.credentials ?? {}) };
		for (const key of connectorOAuthCredentialKeys) delete credentials[key];
		return this.persist(
			{
				...current.value.settings,
				connector: {
					...(current.value.settings.connector ?? {}),
					connectors: {
						...connectors,
						[connectorId]: {
							...connectorWithoutCredentials,
							enabled: connector?.enabled ?? true,
							...(Object.keys(credentials).length ? { credentials } : {}),
						},
					},
				},
			},
			current.value.revision,
			now,
		);
	}

	readExtensionConfiguration(
		extensionId: string,
	): ResultType<JsonObject | undefined, RuntimeAgentSettingsReadError | RuntimeAgentSettingsInvalid> {
		if (!extensionId.trim()) {
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: "Extension id must not be empty",
				}),
			);
		}
		const settings = this.read();
		if (settings.isErr()) return Result.err(settings.error);
		const value = settings.value.extensions[extensionId];
		return Result.ok(value === undefined ? undefined : structuredClone(value));
	}

	writeExtensionConfiguration(
		extensionId: string,
		value: JsonObject,
		now = new Date().toISOString(),
	): ResultType<
		void,
		| RuntimeAgentSettingsReadError
		| RuntimeAgentSettingsInvalid
		| RuntimeAgentSettingsCorrupted
		| RuntimeAgentSettingsWriteConflict
	> {
		if (!extensionId.trim() || !isJsonObject(value)) {
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: "Extension configuration is invalid",
				}),
			);
		}
		const current = this.current();
		if (current.isErr()) return Result.err(current.error);
		const next: RuntimeAgentSettings = {
			...current.value.settings,
			extensions: {
				...current.value.settings.extensions,
				[extensionId]: structuredClone(value),
			},
		};
		const persisted = this.persist(next, current.value.revision, now);
		if (persisted.isErr()) return Result.err(persisted.error);
		return Result.ok(undefined);
	}

	private insertInitial(
		input: RuntimeAgentSettingsInput,
		now: string,
	): ResultType<RuntimeAgentSettingsSnapshot, RuntimeAgentSettingsWriteError> {
		const initial = settingsFromInput(input, emptySettings(input.model));
		if (initial.isErr()) return Result.err(initial.error);
		try {
			this.database
				.prepare(`INSERT INTO runtime_agent_settings (key, settings_json, updated_at) VALUES ('default', ?, ?)`)
				.run(JSON.stringify(initial.value), now);
			return Result.ok(projectSnapshot(initial.value, revisionFor(initial.value)));
		} catch (cause) {
			return Result.err(
				new RuntimeAgentSettingsCorrupted({
					message: "Could not save Runtime Agent settings",
					cause,
				}),
			);
		}
	}

	private persist(
		settings: RuntimeAgentSettings,
		expectedRevision: string,
		now: string,
	): ResultType<RuntimeAgentSettingsSnapshot, RuntimeAgentSettingsWriteError> {
		const validated = validateSettings(settings);
		if (validated.isErr()) return Result.err(validated.error);
		const encoded = JSON.stringify(validated.value);
		try {
			this.database.exec("BEGIN IMMEDIATE");
			const row = this.database
				.prepare("SELECT settings_json FROM runtime_agent_settings WHERE key = 'default'")
				.get() as { readonly settings_json: string } | undefined;
			if (!row || revisionForParsed(row.settings_json) !== expectedRevision) {
				this.database.exec("ROLLBACK");
				return Result.err(
					new RuntimeAgentSettingsWriteConflict({
						message: "Runtime Agent settings changed before they could be saved",
						expectedRevision,
						actualRevision: row ? revisionForParsed(row.settings_json) : null,
					}),
				);
			}
			this.database
				.prepare("UPDATE runtime_agent_settings SET settings_json = ?, updated_at = ? WHERE key = 'default'")
				.run(encoded, now);
			this.database.exec("COMMIT");
			return Result.ok(projectSnapshot(validated.value, revisionFor(validated.value)));
		} catch (cause) {
			try {
				this.database.exec("ROLLBACK");
			} catch {
				// A failed transaction cannot add a second failure to the safe error DTO.
			}
			return Result.err(
				new RuntimeAgentSettingsCorrupted({
					message: "Could not save Runtime Agent settings",
					cause,
				}),
			);
		}
	}

	private current(): ResultType<
		{ readonly settings: RuntimeAgentSettings; readonly revision: string },
		RuntimeAgentSettingsReadError
	> {
		try {
			const row = this.database
				.prepare("SELECT settings_json FROM runtime_agent_settings WHERE key = 'default'")
				.get() as { readonly settings_json: string } | undefined;
			if (!row)
				return Result.err(
					new RuntimeAgentSettingsMissing({
						message: "Runtime Agent settings are not configured",
					}),
				);
			let parsed: unknown;
			try {
				parsed = JSON.parse(row.settings_json) as unknown;
			} catch (cause) {
				return Result.err(
					new RuntimeAgentSettingsCorrupted({
						message: "Runtime Agent settings contain invalid JSON",
						cause,
					}),
				);
			}
			const validated = validateSettings(parsed);
			if (validated.isErr()) {
				return Result.err(
					new RuntimeAgentSettingsCorrupted({
						message: "Runtime Agent settings are invalid",
						cause: validated.error,
					}),
				);
			}
			return Result.ok({
				settings: validated.value,
				revision: revisionFor(validated.value),
			});
		} catch (cause) {
			return Result.err(
				new RuntimeAgentSettingsCorrupted({
					message: "Could not read Runtime Agent settings",
					cause,
				}),
			);
		}
	}
}

export function parseRuntimeAgentSettingsInput(value: unknown): RuntimeAgentSettingsInput | undefined {
	if (
		!isRecord(value) ||
		!hasOnly(value, ["revision", "model", "maxTurns", "language", "reasoningEffort", "providers", "connector"])
	)
		return undefined;
	if ((value.revision !== null && typeof value.revision !== "string") || typeof value.model !== "string")
		return undefined;
	const maxTurns = value.maxTurns;
	if (maxTurns !== undefined && (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns < 1))
		return undefined;
	const language = value.language;
	if (language !== undefined && (typeof language !== "string" || !languagePattern.test(language))) return undefined;
	const reasoningEffort = value.reasoningEffort;
	if (reasoningEffort !== undefined && !isReasoningEffort(reasoningEffort)) return undefined;
	if (!Array.isArray(value.providers)) return undefined;
	if (value.connector !== undefined && !isRuntimeConnectorSettings(value.connector)) return undefined;
	const providers = value.providers.map(parseProfileInput);
	if (providers.some((profile) => profile === undefined)) return undefined;
	return {
		revision: value.revision,
		model: value.model,
		...(maxTurns === undefined ? {} : { maxTurns }),
		...(language === undefined ? {} : { language }),
		...(reasoningEffort === undefined ? {} : { reasoningEffort }),
		providers: providers as RuntimeProviderProfileInput[],
		...(value.connector === undefined ? {} : { connector: value.connector }),
	};
}

export function resolveRuntimeAgentOptions(
	settings: RuntimeAgentSettings,
): ResultType<ResolvedRuntimeAgentOptions, RuntimeAgentSettingsInvalid> {
	const separator = settings.model.indexOf("/");
	const profileId = separator > 0 ? settings.model.slice(0, separator) : "";
	const remoteModelId = separator > 0 ? settings.model.slice(separator + 1) : "";
	const profile = profileId ? settings.providers[profileId] : undefined;
	const execution = resolveExecutionOptions(settings, profile ? sdkProviderKind(profile.adapter) : profileId);
	if (execution.isErr()) return execution;
	if (!profile) {
		return Result.ok({
			model: settings.model,
			...(settings.maxTurns ? { maxTurns: settings.maxTurns } : {}),
			...execution.value,
		});
	}
	if (!profile.enabled) {
		return Result.err(
			new RuntimeAgentSettingsInvalid({
				message: `Provider profile "${profileId}" is disabled`,
			}),
		);
	}
	const selected = Object.values(profile.models).find((model) => (model.remoteModelId ?? model.id) === remoteModelId);
	if (!selected || !selected.enabled) {
		return Result.err(
			new RuntimeAgentSettingsInvalid({
				message: `Model "${settings.model}" is not enabled in Provider profile "${profileId}"`,
			}),
		);
	}
	if (profile.authentication !== "none" && !profile.apiKey) {
		return Result.err(
			new RuntimeAgentSettingsInvalid({
				message: `Provider profile "${profileId}" requires an API key`,
			}),
		);
	}
	const model = `${sdkProviderKind(profile.adapter)}/${selected.remoteModelId ?? selected.id}`;
	return Result.ok({
		model,
		provider: {
			...(profile.apiKey ? { apiKey: profile.apiKey } : {}),
			...(profile.baseURL ? { baseUrl: profile.baseURL } : {}),
			...(profile.headers ? { headers: profile.headers } : {}),
			authentication: providerAuthentication(profile.adapter, profile.authentication),
		},
		...(settings.maxTurns ? { maxTurns: settings.maxTurns } : {}),
		...execution.value,
	});
}

function resolveExecutionOptions(
	settings: RuntimeAgentSettings,
	providerKind: string,
): ResultType<Pick<ResolvedRuntimeAgentOptions, "instructions" | "providerOptions">, RuntimeAgentSettingsInvalid> {
	const instructions = settings.language ? `Respond in ${settings.language}.` : undefined;
	if (!settings.reasoningEffort) return Result.ok(instructions ? { instructions } : {});
	if (providerKind === "openai") {
		return Result.ok({
			...(instructions ? { instructions } : {}),
			providerOptions: {
				openai: {
					reasoning: { effort: settings.reasoningEffort, summary: "auto" },
				},
			},
		});
	}
	if (providerKind === "openai-compatible") {
		return Result.ok({
			...(instructions ? { instructions } : {}),
			providerOptions: {
				"openai-compatible": { reasoning_effort: settings.reasoningEffort },
			},
		});
	}
	return Result.err(
		new RuntimeAgentSettingsInvalid({
			message: `Model "${settings.model}" does not support a configured reasoning effort`,
		}),
	);
}

function parseProfileInput(value: unknown): RuntimeProviderProfileInput | undefined {
	if (
		!isRecord(value) ||
		!hasOnly(value, [
			"id",
			"previousId",
			"name",
			"adapter",
			"baseURL",
			"authentication",
			"apiKey",
			"clearApiKey",
			"headers",
			"enabled",
			"models",
		])
	)
		return undefined;
	if (
		typeof value.id !== "string" ||
		(value.previousId !== undefined && typeof value.previousId !== "string") ||
		typeof value.name !== "string" ||
		!isAdapter(value.adapter) ||
		!isAuthentication(value.authentication) ||
		typeof value.enabled !== "boolean" ||
		(value.baseURL !== undefined && typeof value.baseURL !== "string") ||
		(value.apiKey !== undefined && typeof value.apiKey !== "string") ||
		(value.clearApiKey !== undefined && typeof value.clearApiKey !== "boolean") ||
		!isStringRecord(value.headers) ||
		!Array.isArray(value.models)
	) {
		return undefined;
	}
	const models = value.models.map(parseProviderModel);
	if (models.some((model) => model === undefined)) return undefined;
	return {
		id: value.id,
		...(value.previousId === undefined ? {} : { previousId: value.previousId }),
		name: value.name,
		adapter: value.adapter,
		...(value.baseURL === undefined ? {} : { baseURL: value.baseURL }),
		authentication: value.authentication,
		...(value.apiKey === undefined ? {} : { apiKey: value.apiKey }),
		...(value.clearApiKey === undefined ? {} : { clearApiKey: value.clearApiKey }),
		...(value.headers === undefined ? {} : { headers: value.headers }),
		enabled: value.enabled,
		models: models as RuntimeProviderModel[],
	};
}

function parseProviderModel(value: unknown): RuntimeProviderModel | undefined {
	if (!isRecord(value) || !hasOnly(value, ["id", "remoteModelId", "enabled"])) return undefined;
	if (
		typeof value.id !== "string" ||
		(value.remoteModelId !== undefined && typeof value.remoteModelId !== "string") ||
		typeof value.enabled !== "boolean"
	) {
		return undefined;
	}
	return {
		id: value.id,
		...(value.remoteModelId === undefined ? {} : { remoteModelId: value.remoteModelId }),
		enabled: value.enabled,
	};
}

function settingsFromInput(
	input: RuntimeAgentSettingsInput,
	current: RuntimeAgentSettings,
): ResultType<RuntimeAgentSettings, RuntimeAgentSettingsInvalid> {
	const providers: Record<string, RuntimeProviderProfile> = {};
	for (const inputProfile of input.providers) {
		if (providers[inputProfile.id]) {
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: `Provider profile "${inputProfile.id}" is duplicated`,
				}),
			);
		}
		if (inputProfile.previousId !== undefined && !profileIdPattern.test(inputProfile.previousId)) {
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: `Provider profile "${inputProfile.id}" has an invalid previous id`,
				}),
			);
		}
		const previous =
			current.providers[inputProfile.id] ??
			(inputProfile.previousId === undefined ? undefined : current.providers[inputProfile.previousId]);
		const normalized = normalizeProfile(inputProfile, previous);
		if (normalized.isErr()) return Result.err(normalized.error);
		providers[inputProfile.id] = normalized.value;
	}
	return validateSettings({
		model: input.model.trim(),
		...(input.maxTurns === undefined ? {} : { maxTurns: input.maxTurns }),
		...(input.language === undefined ? {} : { language: input.language }),
		...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
		providers,
		extensions: current.extensions,
		...(input.connector === undefined
			? current.connector === undefined
				? {}
				: { connector: current.connector }
			: {
					connector: mergeConnectorSettings(input.connector, current.connector),
				}),
	});
}

function emptySettings(model: string): RuntimeAgentSettings {
	return { model: model.trim(), providers: {}, extensions: {} };
}

function normalizeProfile(
	input: RuntimeProviderProfileInput,
	previous: RuntimeProviderProfile | undefined,
): ResultType<RuntimeProviderProfile, RuntimeAgentSettingsInvalid> {
	if (!profileIdPattern.test(input.id) || !input.name.trim()) {
		return Result.err(
			new RuntimeAgentSettingsInvalid({
				message: "Provider profile id and name are required",
			}),
		);
	}
	const baseURL = input.baseURL?.trim() || undefined;
	const headers =
		input.headers === undefined
			? previous?.headers
			: Object.keys(input.headers).length > 0
				? normalizeHeaders(input.headers)
				: undefined;
	if (headers instanceof RuntimeAgentSettingsInvalid) return Result.err(headers);
	const connectionChanged =
		previous !== undefined &&
		(previous.adapter !== input.adapter ||
			previous.baseURL !== baseURL ||
			previous.authentication !== input.authentication ||
			!sameHeaders(previous.headers, headers));
	const apiKey = input.clearApiKey
		? undefined
		: input.apiKey?.trim() || (connectionChanged ? undefined : previous?.apiKey);
	if (input.authentication !== "none" && !apiKey) {
		return Result.err(
			new RuntimeAgentSettingsInvalid({
				message: `Provider profile "${input.id}" requires an API key`,
			}),
		);
	}
	if (input.authentication === "none" && (apiKey || input.apiKey?.trim())) {
		return Result.err(
			new RuntimeAgentSettingsInvalid({
				message: `Provider profile "${input.id}" must not include an API key`,
			}),
		);
	}
	if (baseURL) {
		const valid = validateBaseURL(input.id, baseURL);
		if (valid.isErr()) return Result.err(valid.error);
	}
	const models: Record<string, RuntimeProviderModel> = {};
	for (const model of input.models) {
		const id = model.id.trim();
		const remoteModelId = model.remoteModelId?.trim() || undefined;
		if (!modelIdPattern.test(id) || (remoteModelId !== undefined && !modelIdPattern.test(remoteModelId))) {
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: `Provider profile "${input.id}" has an invalid model`,
				}),
			);
		}
		if (models[id]) {
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: `Provider profile "${input.id}" has a duplicate model "${id}"`,
				}),
			);
		}
		models[id] = {
			id,
			...(remoteModelId ? { remoteModelId } : {}),
			enabled: model.enabled,
		};
	}
	return Result.ok({
		name: input.name.trim(),
		adapter: input.adapter,
		...(baseURL ? { baseURL } : {}),
		authentication: input.authentication,
		...(apiKey ? { apiKey } : {}),
		...(headers ? { headers } : {}),
		enabled: input.enabled,
		models,
		...(previous?.modelInventory === undefined ? {} : { modelInventory: previous.modelInventory }),
	});
}

function validateSettings(value: unknown): ResultType<RuntimeAgentSettings, RuntimeAgentSettingsInvalid> {
	if (
		!isRecord(value) ||
		!hasOnly(value, ["model", "maxTurns", "language", "reasoningEffort", "providers", "extensions", "connector"])
	) {
		return Result.err(
			new RuntimeAgentSettingsInvalid({
				message: "Runtime Agent settings are invalid",
			}),
		);
	}
	if (typeof value.model !== "string" || (value.model !== "" && !validModelReference(value.model))) {
		return Result.err(
			new RuntimeAgentSettingsInvalid({
				message: "Runtime Agent model must use <provider-or-profile>/<model>",
			}),
		);
	}
	const maxTurns = value.maxTurns;
	if (maxTurns !== undefined && (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns < 1)) {
		return Result.err(
			new RuntimeAgentSettingsInvalid({
				message: "Runtime Agent maxTurns must be a positive integer",
			}),
		);
	}
	const language = value.language;
	if (language !== undefined && (typeof language !== "string" || !languagePattern.test(language))) {
		return Result.err(
			new RuntimeAgentSettingsInvalid({
				message: "Runtime Agent language must be a valid language tag",
			}),
		);
	}
	const reasoningEffort = value.reasoningEffort;
	if (reasoningEffort !== undefined && !isReasoningEffort(reasoningEffort)) {
		return Result.err(
			new RuntimeAgentSettingsInvalid({
				message: "Runtime Agent reasoning effort is invalid",
			}),
		);
	}
	if (
		!isRecord(value.providers) ||
		!isJsonObjectRecord(value.extensions) ||
		(value.connector !== undefined && !isRuntimeConnectorSettings(value.connector))
	) {
		return Result.err(
			new RuntimeAgentSettingsInvalid({
				message: "Runtime Agent configuration objects are invalid",
			}),
		);
	}
	const providers: Record<string, RuntimeProviderProfile> = {};
	for (const [profileId, profile] of Object.entries(value.providers)) {
		if (!profileIdPattern.test(profileId)) {
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: `Invalid Provider profile id "${profileId}"`,
				}),
			);
		}
		const parsed = parseStoredProfile(profile);
		if (!parsed)
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: `Invalid Provider profile "${profileId}"`,
				}),
			);
		const normalized = normalizeProfile(
			{
				id: profileId,
				name: parsed.name,
				adapter: parsed.adapter,
				...(parsed.baseURL ? { baseURL: parsed.baseURL } : {}),
				authentication: parsed.authentication,
				...(parsed.apiKey ? { apiKey: parsed.apiKey } : {}),
				...(parsed.headers ? { headers: parsed.headers } : {}),
				enabled: parsed.enabled,
				models: Object.values(parsed.models),
			},
			undefined,
		);
		if (normalized.isErr()) return Result.err(normalized.error);
		providers[profileId] = {
			...normalized.value,
			...(parsed.modelInventory === undefined ? {} : { modelInventory: parsed.modelInventory }),
		};
	}
	const settings: RuntimeAgentSettings = {
		model: value.model.trim(),
		...(maxTurns === undefined ? {} : { maxTurns }),
		...(language === undefined ? {} : { language }),
		...(reasoningEffort === undefined ? {} : { reasoningEffort }),
		providers,
		extensions: structuredClone(value.extensions) as Readonly<Record<string, JsonObject>>,
		...(value.connector === undefined
			? {}
			: {
					connector: structuredClone(value.connector) as RuntimeConnectorSettings,
				}),
	};
	const separator = settings.model.indexOf("/");
	const profileId = separator > 0 ? settings.model.slice(0, separator) : "";
	const profile = profileId ? settings.providers[profileId] : undefined;
	const execution = resolveExecutionOptions(settings, profile ? sdkProviderKind(profile.adapter) : profileId);
	return execution.isErr() ? execution : Result.ok(settings);
}

function parseStoredProfile(value: unknown): RuntimeProviderProfile | undefined {
	if (
		!isRecord(value) ||
		!hasOnly(value, [
			"name",
			"adapter",
			"baseURL",
			"authentication",
			"apiKey",
			"headers",
			"enabled",
			"models",
			"modelInventory",
		])
	)
		return undefined;
	if (
		typeof value.name !== "string" ||
		!isAdapter(value.adapter) ||
		(value.baseURL !== undefined && typeof value.baseURL !== "string") ||
		!isAuthentication(value.authentication) ||
		(value.apiKey !== undefined && typeof value.apiKey !== "string") ||
		!isStringRecord(value.headers) ||
		typeof value.enabled !== "boolean" ||
		!isRecord(value.models) ||
		(value.modelInventory !== undefined && !isProviderModelInventory(value.modelInventory))
	) {
		return undefined;
	}
	const models: Record<string, RuntimeProviderModel> = {};
	for (const [modelId, model] of Object.entries(value.models)) {
		const parsed = parseProviderModel(model);
		if (!parsed || parsed.id !== modelId) return undefined;
		models[modelId] = parsed;
	}
	return {
		name: value.name,
		adapter: value.adapter,
		...(value.baseURL === undefined ? {} : { baseURL: value.baseURL }),
		authentication: value.authentication,
		...(value.apiKey === undefined ? {} : { apiKey: value.apiKey }),
		...(value.headers === undefined ? {} : { headers: value.headers }),
		enabled: value.enabled,
		models,
		...(value.modelInventory === undefined ? {} : { modelInventory: value.modelInventory }),
	};
}

function projectSnapshot(settings: RuntimeAgentSettings, revision: string): RuntimeAgentSettingsSnapshot {
	return {
		revision,
		model: settings.model,
		...(settings.maxTurns === undefined ? {} : { maxTurns: settings.maxTurns }),
		...(settings.language === undefined ? {} : { language: settings.language }),
		...(settings.reasoningEffort === undefined ? {} : { reasoningEffort: settings.reasoningEffort }),
		profiles: Object.entries(settings.providers)
			.map(([id, profile]) => ({
				id,
				name: profile.name,
				adapter: profile.adapter,
				...(profile.baseURL ? { baseURL: profile.baseURL } : {}),
				authentication: profile.authentication,
				credentialConfigured: Boolean(profile.apiKey),
				...(profile.apiKey ? { credentialMask: maskCredential(profile.apiKey) } : {}),
				enabled: profile.enabled,
				...(profile.modelInventory === undefined ? {} : { modelsFetchedAt: profile.modelInventory.fetchedAt }),
				models: projectModels(profile),
			}))
			.sort((left, right) => left.name.localeCompare(right.name)),
		connector: projectConnector(settings.connector),
	};
}

function projectModels(profile: RuntimeProviderProfile): readonly RuntimeProviderModel[] {
	const configuredByRemoteId = new Map(
		Object.values(profile.models).map((model) => [model.remoteModelId ?? model.id, model]),
	);
	const remoteModelIds = profile.modelInventory?.modelIds ?? [...configuredByRemoteId.keys()];
	return remoteModelIds
		.map((remoteModelId) => {
			const configured = configuredByRemoteId.get(remoteModelId);
			return {
				id: configured?.id ?? remoteModelId,
				...(configured?.remoteModelId || configured?.id !== remoteModelId ? { remoteModelId } : {}),
				enabled: configured?.enabled ?? false,
			};
		})
		.toSorted((left, right) => (left.remoteModelId ?? left.id).localeCompare(right.remoteModelId ?? right.id));
}

async function discoverModels(profileId: string, profile: RuntimeProviderProfile): Promise<readonly string[]> {
	if (profile.authentication !== "none" && !profile.apiKey) {
		throw new RuntimeAgentSettingsInvalid({
			message: `Provider profile "${profileId}" requires an API key`,
		});
	}
	const apiKey = profile.apiKey ?? "not-required";
	const shared = {
		id: profileId,
		apiKey,
		...(profile.baseURL === undefined ? {} : { baseURL: profile.baseURL }),
		...(profile.headers === undefined ? {} : { headers: profile.headers }),
	};
	const provider: Provider =
		profile.adapter === "anthropic"
			? new AnthropicProvider({
					...shared,
					authentication: profile.authentication === "none" ? "none" : "x-api-key",
				})
			: profile.adapter === "openai-responses"
				? new OpenAIResponsesProvider({
						...shared,
						authentication: profile.authentication === "none" ? "none" : "bearer",
					})
				: new OpenAIProvider({
						...shared,
						authentication: profile.authentication === "none" ? "none" : "bearer",
					});
	if (!provider.listModels) {
		throw new RuntimeAgentSettingsInvalid({
			message: `Provider profile "${profileId}" does not support model discovery`,
		});
	}
	return provider.listModels();
}

function uniqueModelIds(values: readonly string[]): readonly string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))].toSorted((left, right) =>
		left.localeCompare(right),
	);
}

function isProviderModelInventory(value: unknown): value is RuntimeProviderModelInventory {
	return (
		isRecord(value) &&
		Array.isArray(value.modelIds) &&
		value.modelIds.every((modelId) => typeof modelId === "string" && modelId.trim().length > 0) &&
		typeof value.fetchedAt === "number" &&
		Number.isInteger(value.fetchedAt) &&
		value.fetchedAt >= 0
	);
}

function projectConnector(value: RuntimeConnectorSettings | undefined): RuntimeConnectorProjection {
	const policy = value?.policy;
	return {
		policy: {
			default: policy?.default ?? "ask",
			actions: { ...(policy?.actions ?? {}) },
		},
		connectors: Object.entries(value?.connectors ?? {})
			.map(([id, connector]) => ({
				id,
				enabled: connector.enabled !== false,
				credentials: Object.entries(connector.credentials ?? {})
					.filter(([key]) => !connectorOAuthCredentialKeys.has(key))
					.map(([key, credential]) => ({
						key,
						configured: Boolean(credential),
						...(credential ? { mask: maskCredential(credential) } : {}),
					}))
					.toSorted((left, right) => left.key.localeCompare(right.key)),
				...(connector.credentials?.accessToken
					? {
							oauth: {
								connected: true,
								scopes: connector.credentials.scopes?.split(/[\s,]+/u).filter(Boolean) ?? [],
								...(Number.isFinite(Number(connector.credentials.expiresAt))
									? { expiresAt: Number(connector.credentials.expiresAt) }
									: {}),
							},
						}
					: {}),
			}))
			.toSorted((left, right) => left.id.localeCompare(right.id)),
	};
}

function mergeConnectorSettings(
	input: RuntimeConnectorSettings,
	current: RuntimeConnectorSettings | undefined,
): RuntimeConnectorSettings {
	const currentConnectors = current?.connectors ?? {};
	const connectors = { ...currentConnectors };
	for (const [id, next] of Object.entries(input.connectors ?? {})) {
		const previous = currentConnectors[id];
		connectors[id] = {
			...(previous ?? {}),
			...next,
			credentials: {
				...(previous?.credentials ?? {}),
				...(next.credentials ?? {}),
			},
		};
	}
	return {
		...(current ?? {}),
		...input,
		connectors,
		policy: input.policy ?? current?.policy,
	};
}

function validConnectorOAuthToken(value: RuntimeConnectorOAuthTokenInput): boolean {
	return (
		Boolean(value.connectorId.trim()) &&
		Boolean(value.accessToken.trim()) &&
		Boolean(value.tokenType.trim()) &&
		(value.refreshToken === undefined || typeof value.refreshToken === "string") &&
		(value.expiresAt === undefined || (Number.isInteger(value.expiresAt) && value.expiresAt > 0)) &&
		Array.isArray(value.scopes) &&
		value.scopes.every((scope) => typeof scope === "string" && Boolean(scope.trim()))
	);
}

function isRuntimeConnectorPolicy(value: unknown): value is NonNullable<RuntimeConnectorSettings["policy"]> {
	return (
		isRecord(value) &&
		hasOnly(value, ["default", "actions"]) &&
		(value.default === undefined || isConnectorPermission(value.default)) &&
		(value.actions === undefined ||
			(isRecord(value.actions) && Object.values(value.actions).every(isConnectorPermission)))
	);
}

function isRuntimeConnectorSettings(value: unknown): value is RuntimeConnectorSettings {
	if (!isRecord(value) || !hasOnly(value, ["policy", "connectors"])) return false;
	if (value.policy !== undefined) {
		if (!isRuntimeConnectorPolicy(value.policy)) return false;
	}
	if (value.connectors !== undefined) {
		if (!isRecord(value.connectors)) return false;
		for (const [id, connector] of Object.entries(value.connectors)) {
			if (!id.trim() || !isRecord(connector) || !hasOnly(connector, ["enabled", "credentials"])) return false;
			if (connector.enabled !== undefined && typeof connector.enabled !== "boolean") return false;
			if (connector.credentials !== undefined && !isStringRecord(connector.credentials)) return false;
		}
	}
	return true;
}

function isConnectorPermission(value: unknown): value is RuntimeConnectorPermission {
	return value === "ask" || value === "allow" || value === "deny";
}

function validateBaseURL(profileId: string, value: string): ResultType<void, RuntimeAgentSettingsInvalid> {
	try {
		const url = new URL(value);
		const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
		if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password) {
			return Result.err(
				new RuntimeAgentSettingsInvalid({
					message: `Provider profile "${profileId}" baseURL must use HTTPS or loopback HTTP without userinfo`,
				}),
			);
		}
		return Result.ok(undefined);
	} catch {
		return Result.err(
			new RuntimeAgentSettingsInvalid({
				message: `Provider profile "${profileId}" has an invalid baseURL`,
			}),
		);
	}
}

function normalizeHeaders(
	value: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> | RuntimeAgentSettingsInvalid {
	const headers: Record<string, string> = {};
	for (const [name, headerValue] of Object.entries(value)) {
		if (!name.trim() || !headerValue.trim() || sensitiveHeaderPattern.test(name)) {
			return new RuntimeAgentSettingsInvalid({
				message: "Provider headers must not replace authentication",
			});
		}
		headers[name] = headerValue;
	}
	return headers;
}

function sameHeaders(
	left: Readonly<Record<string, string>> | undefined,
	right: Readonly<Record<string, string>> | undefined,
): boolean {
	return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

function validModelReference(value: string): boolean {
	const separator = value.indexOf("/");
	return separator > 0 && separator < value.length - 1 && !/\s/.test(value);
}

function sdkProviderKind(adapter: RuntimeProviderAdapter): "anthropic" | "openai-compatible" | "openai" {
	return adapter === "openai-responses" ? "openai" : adapter;
}

function providerAuthentication(
	adapter: RuntimeProviderAdapter,
	authentication: RuntimeProviderAuthentication,
): CodingProviderOptions["authentication"] {
	if (authentication === "none") return "none";
	return adapter === "anthropic" ? "x-api-key" : "bearer";
}

function maskCredential(value: string): string {
	const suffix = value.slice(-4);
	return suffix ? `•••• ${suffix}` : "••••";
}

function revisionFor(value: RuntimeAgentSettings): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function revisionForParsed(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function isAdapter(value: unknown): value is RuntimeProviderAdapter {
	return value === "anthropic" || value === "openai-compatible" || value === "openai-responses";
}

function isReasoningEffort(value: unknown): value is RuntimeReasoningEffort {
	return value === "low" || value === "medium" || value === "high";
}

function isAuthentication(value: unknown): value is RuntimeProviderAuthentication {
	return value === "api-key" || value === "none";
}

function isStringRecord(value: unknown): value is Readonly<Record<string, string>> | undefined {
	return value === undefined || (isRecord(value) && Object.values(value).every((item) => typeof item === "string"));
}

function isJsonObjectRecord(value: unknown): value is Readonly<Record<string, JsonObject>> {
	return isRecord(value) && Object.values(value).every(isJsonObject);
}

function isJsonObject(value: unknown): value is JsonObject {
	if (!isRecord(value)) return false;
	return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): boolean {
	return (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "string" ||
		(typeof value === "number" && Number.isFinite(value)) ||
		(Array.isArray(value) && value.every(isJsonValue)) ||
		isJsonObject(value)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
	return Object.keys(value).every((key) => keys.includes(key));
}
