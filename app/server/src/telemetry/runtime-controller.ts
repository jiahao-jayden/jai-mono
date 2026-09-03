import type { DatabaseSync } from "node:sqlite";
import { defaultUserTelemetryPolicy, type UserTelemetryPolicy } from "@jai/coding-agent";
import {
	NoopTelemetryContext,
	type TelemetryContext,
	type TelemetrySpan,
	type TelemetrySpanContent,
	type TelemetrySpanName,
	type TelemetrySpanStatus,
	type TelemetryStartSpanOptions,
} from "@jai/telemetry";
import type { TelemetryTextOutput } from "@jai/telemetry/node";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import {
	type LangfuseTelemetryCredentialSnapshot,
	type LangfuseTelemetryCredentials,
	SqliteLangfuseTelemetryCredentials,
} from "./credentials";
import { hasRuntimeTelemetryEnvironmentOverride } from "./environment";
import { type ResolvedRuntimeTelemetry, resolveRuntimeTelemetry } from "./local";
import type { UserTelemetryPolicySnapshot } from "./user-policy";
import { UserTelemetryPolicyStore } from "./user-policy";

export interface RuntimeTelemetrySettingsSnapshot {
	readonly credential: LangfuseTelemetryCredentialSnapshot;
	readonly enabled: boolean;
	readonly endpoint?: string;
	readonly environmentOverride: boolean;
	readonly exporter: "langfuse-otlp";
	readonly policyRevision: string | null;
	readonly configurationError?: string;
}

export interface RuntimeTelemetrySettingsInput {
	readonly clearCredentials?: boolean;
	readonly credentialRevision: string | null;
	readonly enabled: boolean;
	readonly endpoint?: string;
	readonly exporter: "langfuse-otlp";
	readonly policyRevision: string | null;
	readonly publicKey?: string;
	readonly secretKey?: string;
}

export type RuntimeTelemetryCredentialId = "public" | "secret";

export class RuntimeTelemetrySettingsInvalid extends TaggedError("telemetry.settings_invalid")<{
	readonly message: string;
}> {}

export class RuntimeTelemetrySettingsLocked extends TaggedError("telemetry.settings_locked")<{
	readonly message: string;
}> {}

export class RuntimeTelemetrySettingsUpdateFailed extends TaggedError("telemetry.settings_update_failed")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export type RuntimeTelemetrySettingsReadError = RuntimeTelemetrySettingsUpdateFailed;
export type RuntimeTelemetrySettingsWriteError =
	| RuntimeTelemetrySettingsInvalid
	| RuntimeTelemetrySettingsLocked
	| RuntimeTelemetrySettingsUpdateFailed;

export interface OpenRuntimeTelemetryControllerOptions {
	readonly dataDirectory: string;
	readonly database: DatabaseSync;
	readonly environment: Readonly<Record<string, string | undefined>>;
	readonly errorOutput: TelemetryTextOutput;
	readonly resolve?: typeof resolveRuntimeTelemetry;
}

/**
 * The Server-owned live telemetry coordinator. Durable policy and credentials
 * remain separate owners; this controller only owns their active in-memory
 * exporter generation and its safe Desktop projection.
 */
export class RuntimeTelemetryController {
	readonly context: TelemetryContext;
	readonly #credentials: SqliteLangfuseTelemetryCredentials;
	readonly #environment: Readonly<Record<string, string | undefined>>;
	readonly #errorOutput: TelemetryTextOutput;
	readonly #policy: UserTelemetryPolicyStore;
	readonly #resolve: typeof resolveRuntimeTelemetry;
	readonly #context: SwitchingTelemetryContext;
	#closed = false;
	#configurationError?: string;

	private constructor(
		policy: UserTelemetryPolicyStore,
		credentials: SqliteLangfuseTelemetryCredentials,
		options: Omit<OpenRuntimeTelemetryControllerOptions, "database" | "dataDirectory">,
	) {
		this.#policy = policy;
		this.#credentials = credentials;
		this.#environment = options.environment;
		this.#errorOutput = options.errorOutput;
		this.#resolve = options.resolve ?? resolveRuntimeTelemetry;
		this.#context = new SwitchingTelemetryContext();
		this.context = this.#context;
	}

	static async open(
		options: OpenRuntimeTelemetryControllerOptions,
	): Promise<ResultType<RuntimeTelemetryController, RuntimeTelemetrySettingsUpdateFailed>> {
		const controller = new RuntimeTelemetryController(
			new UserTelemetryPolicyStore({ dataDirectory: options.dataDirectory, environment: options.environment }),
			new SqliteLangfuseTelemetryCredentials(options.database),
			options,
		);
		const initialized = await controller.#initialize();
		if (initialized.isErr()) {
			controller.#policy.close();
			return Result.err(initialized.error);
		}
		return Result.ok(controller);
	}

	async snapshot(): Promise<ResultType<RuntimeTelemetrySettingsSnapshot, RuntimeTelemetrySettingsReadError>> {
		if (hasRuntimeTelemetryEnvironmentOverride(this.#environment)) {
			return Result.ok(environmentOverrideSnapshot(this.#configurationError));
		}
		const policy = await this.#policy.snapshot();
		if (policy.isErr()) return Result.ok(this.#unavailablePolicySnapshot(policy.error.message));
		const credential = this.#credentials.snapshot();
		if (credential.isErr()) {
			return Result.ok(this.#project(policy.value, { revision: null, configured: false }, credential.error.message));
		}
		return Result.ok(this.#project(policy.value, credential.value, policy.value.configurationError));
	}

	async save(
		input: RuntimeTelemetrySettingsInput,
	): Promise<ResultType<RuntimeTelemetrySettingsSnapshot, RuntimeTelemetrySettingsWriteError>> {
		if (this.#closed)
			return Result.err(new RuntimeTelemetrySettingsLocked({ message: "Telemetry settings are unavailable" }));
		if (hasRuntimeTelemetryEnvironmentOverride(this.#environment)) {
			return Result.err(
				new RuntimeTelemetrySettingsLocked({
					message: "Telemetry settings are controlled by JAI_TELEMETRY environment variables",
				}),
			);
		}
		const parsed = parseRuntimeTelemetrySettingsInput(input);
		if (!parsed) return invalid("Telemetry settings input is invalid");
		const currentPolicy = await this.#policy.snapshot();
		if (currentPolicy.isErr()) return Result.err(readFailed(currentPolicy.error));
		const currentCredential = this.#credentials.snapshot();
		if (currentCredential.isErr()) return Result.err(readFailed(currentCredential.error));
		const nextCredential = this.#candidateCredentials(parsed, currentCredential.value);
		if (nextCredential.isErr()) return Result.err(nextCredential.error);
		const resolved = this.#resolvePolicy(parsed.policy, nextCredential.value);
		if (resolved.isErr()) return Result.err(resolved.error);

		const policyChanged = !samePolicy(currentPolicy.value.policy, parsed.policy);
		const credentialChanged = parsed.credentialChange !== "keep";
		let persistedPolicy = currentPolicy.value;
		if (policyChanged) {
			const saved = await this.#policy.write({
				revision: parsed.policyRevision,
				policy: parsed.policy,
			});
			if (saved.isErr()) return Result.err(writeFailed(saved.error));
			persistedPolicy = saved.value;
		}
		let persistedCredential = currentCredential.value;
		if (credentialChanged) {
			const saved =
				parsed.credentialChange === "clear"
					? this.#credentials.clear(parsed.credentialRevision)
					: this.#credentials.replace({
							revision: parsed.credentialRevision,
							publicKey: parsed.credentialChange.publicKey,
							secretKey: parsed.credentialChange.secretKey,
						});
			if (saved.isErr()) {
				if (policyChanged) {
					await this.#policy.write({
						revision: persistedPolicy.revision,
						policy: currentPolicy.value.policy,
					});
				}
				return Result.err(writeFailed(saved.error));
			}
			persistedCredential = saved.value;
		}
		this.#context.replace(resolved.value);
		this.#configurationError = undefined;
		return Result.ok(this.#project(persistedPolicy, persistedCredential));
	}

	revealCredential(
		credentialId: RuntimeTelemetryCredentialId,
	): ResultType<
		{ readonly credentialId: RuntimeTelemetryCredentialId; readonly value: string },
		RuntimeTelemetrySettingsReadError | RuntimeTelemetrySettingsInvalid | RuntimeTelemetrySettingsLocked
	> {
		if (this.#closed) return Result.err(new RuntimeTelemetrySettingsLocked({ message: "Telemetry settings are unavailable" }));
		if (hasRuntimeTelemetryEnvironmentOverride(this.#environment)) {
			return Result.err(
				new RuntimeTelemetrySettingsLocked({
					message: "Telemetry credentials are controlled by JAI_TELEMETRY environment variables",
				}),
			);
		}
		if (!isRuntimeTelemetryCredentialId(credentialId)) {
			return Result.err(new RuntimeTelemetrySettingsInvalid({ message: "Telemetry credential id is invalid" }));
		}
		const credentials = this.#credentials.readForExporter();
		if (credentials.isErr()) return Result.err(readFailed(credentials.error));
		const value = credentials.value?.[credentialId === "public" ? "publicKey" : "secretKey"];
		if (!value) {
			return Result.err(new RuntimeTelemetrySettingsInvalid({ message: "Telemetry credential is not configured" }));
		}
		return Result.ok({ credentialId, value });
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		this.#policy.close();
		await this.#context.close();
	}

	async #initialize(): Promise<ResultType<void, RuntimeTelemetrySettingsUpdateFailed>> {
		if (hasRuntimeTelemetryEnvironmentOverride(this.#environment)) {
			const resolved = this.#resolve({ environment: this.#environment, errorOutput: this.#errorOutput });
			if (resolved.isErr()) {
				this.#configurationError = resolved.error.message;
				return Result.ok(undefined);
			}
			this.#context.replace(resolved.value);
			return Result.ok(undefined);
		}
		const policy = await this.#policy.snapshot();
		if (policy.isErr()) {
			this.#configurationError = policy.error.message;
			return Result.ok(undefined);
		}
		if (policy.value.configurationError) {
			this.#configurationError = policy.value.configurationError;
			return Result.ok(undefined);
		}
		const credential = this.#credentials.readForExporter();
		if (credential.isErr()) {
			this.#configurationError = credential.error.message;
			return Result.ok(undefined);
		}
		const resolved = this.#resolvePolicy(policy.value.policy, credential.value);
		if (resolved.isErr()) {
			// A telemetry-only failure never prevents the Host from accepting Agent work.
			this.#configurationError = resolved.error.message;
			return Result.ok(undefined);
		}
		this.#context.replace(resolved.value);
		return Result.ok(undefined);
	}

	#candidateCredentials(
		input: ParsedRuntimeTelemetrySettingsInput,
		current: LangfuseTelemetryCredentialSnapshot,
	): ResultType<LangfuseTelemetryCredentials | undefined, RuntimeTelemetrySettingsInvalid> {
		if (input.credentialChange === "clear") return Result.ok(undefined);
		if (input.credentialChange !== "keep") return Result.ok(input.credentialChange);
		if (!current.configured) return Result.ok(undefined);
		const credentials = this.#credentials.readForExporter();
		if (credentials.isErr()) return invalid(credentials.error.message);
		return Result.ok(credentials.value);
	}

	#resolvePolicy(
		policy: UserTelemetryPolicy,
		credentials: LangfuseTelemetryCredentials | undefined,
	): ResultType<ResolvedRuntimeTelemetry, RuntimeTelemetrySettingsInvalid> {
		if (!policy.enabled) return Result.ok({ context: new NoopTelemetryContext() });
		if (!policy.endpoint || !credentials) {
			return invalid("Enabled telemetry requires a Langfuse endpoint and both credentials");
		}
		const resolved = this.#resolve({
			environment: {
				JAI_TELEMETRY_LANGFUSE_PUBLIC_KEY: credentials.publicKey,
				JAI_TELEMETRY_LANGFUSE_SECRET_KEY: credentials.secretKey,
				JAI_TELEMETRY_OTLP_ENDPOINT: policy.endpoint,
			},
			errorOutput: this.#errorOutput,
		});
		return resolved.isErr() ? invalid(resolved.error.message) : Result.ok(resolved.value);
	}

	#project(
		policy: UserTelemetryPolicySnapshot,
		credential: LangfuseTelemetryCredentialSnapshot,
		explicitConfigurationError?: string,
	): RuntimeTelemetrySettingsSnapshot {
		const configurationError =
			explicitConfigurationError ??
			this.#configurationError ??
			(policy.policy.enabled && !credential.configured
				? "Enabled telemetry requires Langfuse public and secret keys"
				: undefined);
		return {
			credential,
			enabled: policy.policy.enabled,
			...(policy.policy.endpoint === undefined ? {} : { endpoint: policy.policy.endpoint }),
			environmentOverride: false,
			exporter: policy.policy.exporter,
			policyRevision: policy.revision,
			...(configurationError === undefined ? {} : { configurationError }),
		};
	}

	#unavailablePolicySnapshot(configurationError: string): RuntimeTelemetrySettingsSnapshot {
		return this.#project(
			{ revision: null, policy: defaultUserTelemetryPolicy, environmentOverride: false },
			{ revision: null, configured: false },
			configurationError,
		);
	}
}

type ParsedRuntimeTelemetrySettingsInput = {
	readonly credentialChange: "clear" | "keep" | { readonly publicKey: string; readonly secretKey: string };
	readonly credentialRevision: string | null;
	readonly policy: UserTelemetryPolicy;
	readonly policyRevision: string | null;
};

export function parseRuntimeTelemetrySettingsInput(value: unknown): ParsedRuntimeTelemetrySettingsInput | undefined {
	if (!record(value) || !allowedInputKeys(value)) return undefined;
	if (
		(value.policyRevision !== null && typeof value.policyRevision !== "string") ||
		(value.credentialRevision !== null && typeof value.credentialRevision !== "string") ||
		typeof value.enabled !== "boolean" ||
		value.exporter !== "langfuse-otlp" ||
		(value.endpoint !== undefined && typeof value.endpoint !== "string") ||
		(value.clearCredentials !== undefined && typeof value.clearCredentials !== "boolean") ||
		(value.publicKey !== undefined && typeof value.publicKey !== "string") ||
		(value.secretKey !== undefined && typeof value.secretKey !== "string")
	) {
		return undefined;
	}
	const hasPublicKey = value.publicKey !== undefined;
	const hasSecretKey = value.secretKey !== undefined;
	if (hasPublicKey !== hasSecretKey) return undefined;
	if (value.clearCredentials === true && hasPublicKey) return undefined;
	const endpoint = value.endpoint?.trim();
	if (value.endpoint !== undefined && !endpoint) return undefined;
	if (value.enabled && endpoint === undefined) return undefined;
	const policy: UserTelemetryPolicy = {
		enabled: value.enabled,
		exporter: "langfuse-otlp",
		...(endpoint === undefined ? {} : { endpoint }),
	};
	return {
		credentialChange:
			value.clearCredentials === true
				? "clear"
				: hasPublicKey
					? { publicKey: value.publicKey!, secretKey: value.secretKey! }
					: "keep",
		credentialRevision: value.credentialRevision,
		policy,
		policyRevision: value.policyRevision,
	};
}

class SwitchingTelemetryContext implements TelemetryContext {
	readonly #fallback = new NoopTelemetryContext();
	readonly #generations = new Set<TelemetryGeneration>();
	#current: TelemetryGeneration;
	#closed = false;

	constructor() {
		this.#current = new TelemetryGeneration({ context: new NoopTelemetryContext() });
		this.#generations.add(this.#current);
	}

	get contentCaptureEnabled(): boolean {
		return this.#current.resource.context.contentCaptureEnabled;
	}

	startSpan<Name extends TelemetrySpanName>(options: TelemetryStartSpanOptions<Name>): TelemetrySpan<Name> {
		const parent = options.parent;
		const generation = parent instanceof SwitchingTelemetrySpan ? parent.generation : this.#current;
		let span: TelemetrySpan<Name>;
		try {
			span =
				parent instanceof SwitchingTelemetrySpan
					? generation.resource.context.startSpan({
							...options,
							parent: parent.inner,
						} as TelemetryStartSpanOptions<Name>)
					: generation.resource.context.startSpan(options);
		} catch {
			span = this.#fallback.startSpan(options);
		}
		generation.active += 1;
		return new SwitchingTelemetrySpan(span, generation, () => this.#release(generation));
	}

	replace(resource: ResolvedRuntimeTelemetry): void {
		if (this.#closed) {
			void closeResource(resource);
			return;
		}
		const previous = this.#current;
		this.#current = new TelemetryGeneration(resource);
		this.#generations.add(this.#current);
		previous.retired = true;
		this.#closeWhenSettled(previous);
	}

	async close(): Promise<void> {
		if (this.#closed) return;
		this.#closed = true;
		for (const generation of this.#generations) generation.retired = true;
		await Promise.all([...this.#generations].map((generation) => generation.close()));
	}

	#release(generation: TelemetryGeneration): void {
		generation.active = Math.max(0, generation.active - 1);
		this.#closeWhenSettled(generation);
	}

	#closeWhenSettled(generation: TelemetryGeneration): void {
		if (generation.retired && generation.active === 0) {
			void generation.close().finally(() => this.#generations.delete(generation));
		}
	}
}

class SwitchingTelemetrySpan<Name extends TelemetrySpanName> implements TelemetrySpan<Name> {
	#settled = false;

	constructor(
		readonly inner: TelemetrySpan<Name>,
		readonly generation: TelemetryGeneration,
		private readonly release: () => void,
	) {}

	get id(): string {
		return this.inner.id;
	}

	get contentCaptureEnabled(): boolean {
		return this.inner.contentCaptureEnabled;
	}

	get name(): Name {
		return this.inner.name;
	}

	addEvent(...args: Parameters<TelemetrySpan<Name>["addEvent"]>): void {
		try {
			this.inner.addEvent(...args);
		} catch {
			return;
		}
	}

	recordContent(content: TelemetrySpanContent): void {
		try {
			this.inner.recordContent(content);
		} catch {
			return;
		}
	}

	setAttributes(...args: Parameters<TelemetrySpan<Name>["setAttributes"]>): void {
		try {
			this.inner.setAttributes(...args);
		} catch {
			return;
		}
	}

	setStatus(status: TelemetrySpanStatus): void {
		if (this.#settled) return;
		this.#settled = true;
		try {
			this.inner.setStatus(status);
		} catch {
			// Telemetry is best effort and never changes the caller's operation outcome.
		} finally {
			this.release();
		}
	}
}

class TelemetryGeneration {
	active = 0;
	retired = false;
	#closing?: Promise<void>;

	constructor(readonly resource: ResolvedRuntimeTelemetry) {}

	close(): Promise<void> {
		if (this.#closing) return this.#closing;
		this.#closing = closeResource(this.resource);
		return this.#closing;
	}
}

function environmentOverrideSnapshot(configurationError?: string): RuntimeTelemetrySettingsSnapshot {
	return {
		credential: { revision: null, configured: false },
		enabled: false,
		environmentOverride: true,
		exporter: "langfuse-otlp",
		policyRevision: null,
		...(configurationError === undefined ? {} : { configurationError }),
	};
}

function samePolicy(left: UserTelemetryPolicy, right: UserTelemetryPolicy): boolean {
	return left.enabled === right.enabled && left.exporter === right.exporter && left.endpoint === right.endpoint;
}

function allowedInputKeys(value: Record<string, unknown>): boolean {
	return Object.keys(value).every((key) =>
		[
			"clearCredentials",
			"credentialRevision",
			"enabled",
			"endpoint",
			"exporter",
			"policyRevision",
			"publicKey",
			"secretKey",
		].includes(key),
	);
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuntimeTelemetryCredentialId(value: unknown): value is RuntimeTelemetryCredentialId {
	return value === "public" || value === "secret";
}

function invalid(message: string): ResultType<never, RuntimeTelemetrySettingsInvalid> {
	return Result.err(new RuntimeTelemetrySettingsInvalid({ message }));
}

function readFailed(cause: { readonly message: string }): RuntimeTelemetrySettingsUpdateFailed {
	return new RuntimeTelemetrySettingsUpdateFailed({ message: cause.message, cause });
}

function writeFailed(cause: { readonly message: string }): RuntimeTelemetrySettingsUpdateFailed {
	return new RuntimeTelemetrySettingsUpdateFailed({ message: cause.message, cause });
}

async function closeResource(resource: ResolvedRuntimeTelemetry): Promise<void> {
	try {
		await resource.close?.();
	} catch {
		return;
	}
}
