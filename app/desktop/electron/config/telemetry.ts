import type { RuntimeTelemetrySettingsInput, RuntimeTelemetrySettingsSnapshot } from "@jai/server";
import { TaggedError } from "better-result";
import type { DesktopTelemetrySettingsInput, DesktopTelemetrySettingsSnapshot } from "../../shared/desktop-rpc";

export class DesktopTelemetrySettingsInvalid extends TaggedError("desktop_telemetry.invalid_input")<{
	readonly message: string;
}> {}

/** Projects the Server's telemetry snapshot into the explicit Desktop DTO. */
export function projectRuntimeTelemetrySettings(
	snapshot: RuntimeTelemetrySettingsSnapshot,
): DesktopTelemetrySettingsSnapshot {
	return {
		credential: {
			revision: snapshot.credential.revision,
			configured: snapshot.credential.configured,
			...(snapshot.credential.publicKeyMask === undefined
				? {}
				: { publicKeyMask: snapshot.credential.publicKeyMask }),
			...(snapshot.credential.secretKeyMask === undefined
				? {}
				: { secretKeyMask: snapshot.credential.secretKeyMask }),
		},
		enabled: snapshot.enabled,
		...(snapshot.endpoint === undefined ? {} : { endpoint: snapshot.endpoint }),
		environmentOverride: snapshot.environmentOverride,
		exporter: "langfuse-otlp",
		policyRevision: snapshot.policyRevision,
		...(snapshot.configurationError === undefined ? {} : { configurationError: snapshot.configurationError }),
	};
}

/** Validates and white-lists the one-shot settings payload before it reaches the Server. */
export function toRuntimeTelemetrySettingsInput(input: DesktopTelemetrySettingsInput): RuntimeTelemetrySettingsInput {
	if (!isRecord(input) || !allowedKeys(input)) throw invalid("Invalid telemetry configuration");
	if (
		(input.policyRevision !== null && typeof input.policyRevision !== "string") ||
		(input.credentialRevision !== null && typeof input.credentialRevision !== "string") ||
		typeof input.enabled !== "boolean" ||
		input.exporter !== "langfuse-otlp" ||
		(input.endpoint !== undefined && typeof input.endpoint !== "string") ||
		(input.publicKey !== undefined && typeof input.publicKey !== "string") ||
		(input.secretKey !== undefined && typeof input.secretKey !== "string") ||
		(input.clearCredentials !== undefined && typeof input.clearCredentials !== "boolean")
	) {
		throw invalid("Invalid telemetry configuration");
	}
	const endpoint = input.endpoint?.trim();
	if (input.endpoint !== undefined && (!endpoint || !isHttpUrl(endpoint))) {
		throw invalid("Langfuse endpoint must be an HTTP URL");
	}
	if (input.enabled && endpoint === undefined) {
		throw invalid("Enabled telemetry requires a Langfuse endpoint");
	}
	const publicKey = input.publicKey?.trim();
	const secretKey = input.secretKey?.trim();
	if ((publicKey === undefined) !== (secretKey === undefined)) {
		throw invalid("Langfuse public and secret keys must be provided together");
	}
	if ((publicKey !== undefined && !publicKey) || (secretKey !== undefined && !secretKey)) {
		throw invalid("Langfuse public and secret keys cannot be empty");
	}
	if (input.clearCredentials && publicKey !== undefined) {
		throw invalid("Credentials cannot be replaced and cleared in the same save");
	}
	return {
		credentialRevision: input.credentialRevision,
		enabled: input.enabled,
		...(endpoint === undefined ? {} : { endpoint }),
		exporter: "langfuse-otlp",
		policyRevision: input.policyRevision,
		...(publicKey === undefined ? {} : { publicKey }),
		...(secretKey === undefined ? {} : { secretKey }),
		...(input.clearCredentials === true ? { clearCredentials: true } : {}),
	};
}

function allowedKeys(value: Record<string, unknown>): boolean {
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

function invalid(message: string): DesktopTelemetrySettingsInvalid {
	return new DesktopTelemetrySettingsInvalid({ message });
}

function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
