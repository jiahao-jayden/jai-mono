import { defineCodedError, type JsonValue } from "@jai/common";
import type { ConfigFileScope } from "./types";

const configError = defineCodedError("coding_config", [
	"definition_invalid",
	"read_failed",
	"parse_failed",
	"validation_failed",
	"unsupported_version",
	"migration_failed",
	"write_conflict",
	"write_failed",
	"watch_failed",
] as const);

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

export function configMigrationError(data: FileErrorData & { readonly fromVersion: number }, cause: unknown) {
	return configError("migration_failed", {
		message: `Failed to migrate configuration from version ${data.fromVersion} in ${data.path}`,
		data: { scope: data.scope, path: data.path, fromVersion: data.fromVersion },
		cause,
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
