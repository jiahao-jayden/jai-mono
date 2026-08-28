import type { JsonValue } from "@jai/common";
import { TaggedError } from "better-result";
import type { ConfigFileScope } from "./types";

type ConfigErrorInit = { readonly cause?: unknown; readonly data?: JsonValue; readonly message: string };
class ConfigDefinitionInvalid extends TaggedError("coding_config.definition_invalid")<ConfigErrorInit> {}
class ConfigReadFailed extends TaggedError("coding_config.read_failed")<ConfigErrorInit> {}
class ConfigParseFailed extends TaggedError("coding_config.parse_failed")<ConfigErrorInit> {}
class ConfigValidationFailed extends TaggedError("coding_config.validation_failed")<ConfigErrorInit> {}
class ConfigUnsupportedVersion extends TaggedError("coding_config.unsupported_version")<ConfigErrorInit> {}
class ConfigWriteConflict extends TaggedError("coding_config.write_conflict")<ConfigErrorInit> {}
class ConfigWriteFailed extends TaggedError("coding_config.write_failed")<ConfigErrorInit> {}
class ConfigWatchFailed extends TaggedError("coding_config.watch_failed")<ConfigErrorInit> {}
class ConfigScopeUnavailable extends TaggedError("coding_config.scope_unavailable")<ConfigErrorInit> {}

function configError(
	reason:
		| "definition_invalid"
		| "read_failed"
		| "parse_failed"
		| "validation_failed"
		| "unsupported_version"
		| "write_conflict"
		| "write_failed"
		| "watch_failed"
		| "scope_unavailable",
	init: ConfigErrorInit,
) {
	switch (reason) {
		case "definition_invalid":
			return new ConfigDefinitionInvalid(init);
		case "read_failed":
			return new ConfigReadFailed(init);
		case "parse_failed":
			return new ConfigParseFailed(init);
		case "validation_failed":
			return new ConfigValidationFailed(init);
		case "unsupported_version":
			return new ConfigUnsupportedVersion(init);
		case "write_conflict":
			return new ConfigWriteConflict(init);
		case "write_failed":
			return new ConfigWriteFailed(init);
		case "watch_failed":
			return new ConfigWatchFailed(init);
		case "scope_unavailable":
			return new ConfigScopeUnavailable(init);
	}
}

interface FileErrorData {
	readonly scope: ConfigFileScope;
	readonly path: string;
}

export function configDefinitionError(message: string, path?: string) {
	return configError("definition_invalid", {
		message,
		data: path === undefined ? undefined : { path },
	});
}

export function configParseError(data: FileErrorData, cause: unknown) {
	return configError("parse_failed", {
		message: `Invalid JSON in ${data.path}`,
		data: { scope: data.scope, path: data.path },
		cause,
	});
}

export function configReadError(data: FileErrorData, cause: unknown) {
	return configError("read_failed", {
		message: `Failed to read configuration: ${data.path}`,
		data: { scope: data.scope, path: data.path },
		cause,
	});
}

export function configValidationError(
	message: string,
	data: FileErrorData & { readonly issues: readonly { readonly path: string; readonly message: string }[] },
) {
	return configError("validation_failed", {
		message,
		data: {
			scope: data.scope,
			path: data.path,
			issues: data.issues.map((issue) => ({ path: issue.path, message: issue.message })),
		},
	});
}

export function resolvedConfigValidationError(issues: readonly { readonly path: string; readonly message: string }[]) {
	return configError("validation_failed", {
		message: "Resolved coding configuration is invalid",
		data: { issues: issues.map((issue) => ({ path: issue.path, message: issue.message })) },
	});
}

export function configUnsupportedVersionError(
	data: FileErrorData & { readonly expectedVersion: number; readonly actualVersion: number },
) {
	return configError("unsupported_version", {
		message: `Unsupported configuration version ${data.actualVersion} in ${data.path}`,
		data: {
			scope: data.scope,
			path: data.path,
			expectedVersion: data.expectedVersion,
			actualVersion: data.actualVersion,
		},
	});
}

export function configWriteConflictError(
	data: FileErrorData & { readonly expectedRevision: string | null; readonly actualRevision: string | null },
) {
	return configError("write_conflict", {
		message: `Configuration changed before it could be written: ${data.path}`,
		data: {
			scope: data.scope,
			path: data.path,
			expectedRevision: data.expectedRevision,
			actualRevision: data.actualRevision,
		},
	});
}

export function configWriteError(data: FileErrorData, cause: unknown) {
	return configError("write_failed", {
		message: `Failed to write configuration: ${data.path}`,
		data: { scope: data.scope, path: data.path },
		cause,
	});
}

export function configWatchError(paths: readonly string[], cause: unknown) {
	return configError("watch_failed", {
		message: "Failed to watch coding configuration",
		data: { paths: [...paths] } satisfies JsonValue,
		cause,
	});
}

export function configScopeUnavailableError(scope: ConfigFileScope) {
	return configError("scope_unavailable", {
		message: `Configuration scope "${scope}" is unavailable without a project root`,
		data: { scope },
	});
}
