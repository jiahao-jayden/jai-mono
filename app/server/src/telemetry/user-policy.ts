import { join } from "node:path";
import {
	CodingConfigStore,
	defaultUserTelemetryPolicy,
	sdkConfigDefinition,
	type UserTelemetryPolicy,
} from "@jai/coding-agent";
import { Result, type Result as ResultType, TaggedError } from "better-result";
import { hasRuntimeTelemetryEnvironmentOverride } from "./environment";

export interface UserTelemetryPolicySnapshot {
	readonly revision: string | null;
	readonly policy: UserTelemetryPolicy;
	readonly environmentOverride: boolean;
	readonly configurationError?: string;
}

export interface UserTelemetryPolicyWrite {
	readonly revision: string | null;
	readonly policy: UserTelemetryPolicy;
}

export class UserTelemetryPolicyInvalid extends TaggedError("telemetry.policy_invalid")<{
	readonly message: string;
}> {}

export class UserTelemetryPolicyReadFailed extends TaggedError("telemetry.policy_read_failed")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class UserTelemetryPolicyWriteFailed extends TaggedError("telemetry.policy_write_failed")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export type UserTelemetryPolicyReadError = UserTelemetryPolicyInvalid | UserTelemetryPolicyReadFailed;
export type UserTelemetryPolicyWriteError =
	| UserTelemetryPolicyInvalid
	| UserTelemetryPolicyReadFailed
	| UserTelemetryPolicyWriteFailed;

/** Server owner for the telemetry slice of the shared user settings document. */
export class UserTelemetryPolicyStore {
	readonly #config: CodingConfigStore<typeof sdkConfigDefinition.schema>;
	readonly #environment: Readonly<Record<string, string | undefined>>;

	constructor(options: {
		readonly dataDirectory: string;
		readonly environment?: Readonly<Record<string, string | undefined>>;
	}) {
		this.#config = new CodingConfigStore(sdkConfigDefinition, {
			userConfigPath: join(options.dataDirectory, "settings.json"),
		});
		this.#environment = options.environment ?? process.env;
	}

	async snapshot(): Promise<ResultType<UserTelemetryPolicySnapshot, UserTelemetryPolicyReadError>> {
		try {
			const current = await this.#config.readScope("user");
			const policy = parseUserTelemetryPolicy(current.settings.telemetry);
			return Result.ok({
				revision: current.revision,
				policy: policy.isOk() ? policy.value : defaultUserTelemetryPolicy,
				environmentOverride: hasRuntimeTelemetryEnvironmentOverride(this.#environment),
				...(policy.isErr() ? { configurationError: policy.error.message } : {}),
			});
		} catch (cause) {
			return Result.err(
				new UserTelemetryPolicyReadFailed({
					message: "Could not read the telemetry policy",
					cause,
				}),
			);
		}
	}

	async write(
		input: UserTelemetryPolicyWrite,
	): Promise<ResultType<UserTelemetryPolicySnapshot, UserTelemetryPolicyWriteError>> {
		const policy = parseUserTelemetryPolicy(input.policy);
		if (policy.isErr()) return Result.err(policy.error);
		try {
			const current = await this.#config.readScope("user");
			await this.#config.writeScope(
				"user",
				{ ...current.settings, telemetry: policy.value },
				{ expectedRevision: input.revision },
			);
		} catch (cause) {
			return Result.err(
				new UserTelemetryPolicyWriteFailed({
					message: "Could not save the telemetry policy",
					cause,
				}),
			);
		}
		const snapshot = await this.snapshot();
		return snapshot.isErr() ? Result.err(snapshot.error) : Result.ok(snapshot.value);
	}

	close(): void {
		this.#config.close();
	}
}

export function parseUserTelemetryPolicy(value: unknown): ResultType<UserTelemetryPolicy, UserTelemetryPolicyInvalid> {
	if (value === undefined) return Result.ok(defaultUserTelemetryPolicy);
	if (!isRecord(value)) return invalid("Telemetry policy must be an object");
	if (typeof value.enabled !== "boolean") return invalid("Telemetry policy enabled must be a boolean");
	if (value.exporter !== "langfuse-otlp") return invalid("Telemetry exporter is not supported");
	if (value.endpoint !== undefined && typeof value.endpoint !== "string") {
		return invalid("Telemetry endpoint must be a string");
	}
	const endpoint = value.endpoint?.trim();
	if (value.endpoint !== undefined && !endpoint) return invalid("Telemetry endpoint cannot be empty");
	if (endpoint !== undefined && !isHttpUrl(endpoint)) {
		return invalid("Telemetry endpoint must be an HTTP URL");
	}
	if (value.enabled && endpoint === undefined) {
		return invalid("Enabled telemetry requires an OTLP endpoint");
	}
	return Result.ok({
		enabled: value.enabled,
		exporter: value.exporter,
		...(endpoint === undefined ? {} : { endpoint }),
	});
}

function invalid(message: string): ResultType<never, UserTelemetryPolicyInvalid> {
	return Result.err(new UserTelemetryPolicyInvalid({ message }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}
