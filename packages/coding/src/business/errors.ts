import { defineCodedError } from "@jai/common";

const businessError = defineCodedError("coding_business", [
	"workspace_not_found",
	"workspace_path_invalid",
	"workspace_path_conflict",
	"workspace_unavailable",
	"session_not_found",
	"session_file_missing",
	"session_file_conflict",
	"session_busy",
	"storage_inconsistent",
	"database_invalid",
	"database_unsupported",
] as const);

export const workspaceNotFoundError = (workspaceId: string) =>
	businessError("workspace_not_found", {
		message: `Workspace "${workspaceId}" does not exist`,
		data: { workspaceId },
	});

export const workspacePathInvalidError = (path: string, cause?: unknown) =>
	businessError("workspace_path_invalid", {
		message: `Workspace path is not an accessible directory: ${path}`,
		data: { path },
		cause,
	});

export const workspacePathConflictError = (canonicalPath: string, cause?: unknown) =>
	businessError("workspace_path_conflict", {
		message: `A Workspace already uses "${canonicalPath}"`,
		data: { canonicalPath },
		cause,
	});

export const workspaceUnavailableError = (workspaceId: string, cause?: unknown) =>
	businessError("workspace_unavailable", {
		message: `Workspace "${workspaceId}" must be relinked before local tools can run`,
		data: { workspaceId },
		cause,
	});

export const sessionNotFoundError = (sessionId: string) =>
	businessError("session_not_found", {
		message: `Session "${sessionId}" does not exist`,
		data: { sessionId },
	});

export const sessionFileMissingError = (sessionId: string) =>
	businessError("session_file_missing", {
		message: `Session file "${sessionId}.jsonl" does not exist`,
		data: { sessionId },
	});

export const sessionFileConflictError = (sessionId: string) =>
	businessError("session_file_conflict", {
		message: `Session file "${sessionId}.jsonl" already exists at the destination`,
		data: { sessionId },
	});

export const sessionBusyError = (sessionId: string, cause?: unknown) =>
	businessError("session_busy", {
		message: `Session "${sessionId}" is busy`,
		data: { sessionId },
		cause,
	});

export const storageInconsistentError = (sessionId: string, cause?: unknown) =>
	businessError("storage_inconsistent", {
		message: `Session "${sessionId}" metadata and file location are inconsistent`,
		data: { sessionId },
		cause,
	});

export const databaseInvalidError = (message: string) =>
	businessError("database_invalid", {
		message,
	});

export const databaseUnsupportedError = (version: number) =>
	businessError("database_unsupported", {
		message: `Unsupported coding business database version ${version}`,
		data: { version },
	});
