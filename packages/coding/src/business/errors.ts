import { TaggedError } from "better-result";

type BusinessErrorInit = {
	readonly cause?: unknown;
	readonly data?: Record<string, unknown>;
	readonly message: string;
};
class WorkspaceNotFound extends TaggedError("coding_business.workspace_not_found")<BusinessErrorInit> {}
class WorkspacePathInvalid extends TaggedError("coding_business.workspace_path_invalid")<BusinessErrorInit> {}
class WorkspacePathConflict extends TaggedError("coding_business.workspace_path_conflict")<BusinessErrorInit> {}
class WorkspaceUnavailable extends TaggedError("coding_business.workspace_unavailable")<BusinessErrorInit> {}
class SessionNotFound extends TaggedError("coding_business.session_not_found")<BusinessErrorInit> {}
class SessionFileMissing extends TaggedError("coding_business.session_file_missing")<BusinessErrorInit> {}
class SessionFileConflict extends TaggedError("coding_business.session_file_conflict")<BusinessErrorInit> {}
class SessionBusy extends TaggedError("coding_business.session_busy")<BusinessErrorInit> {}
class StorageInconsistent extends TaggedError("coding_business.storage_inconsistent")<BusinessErrorInit> {}
class DatabaseInvalid extends TaggedError("coding_business.database_invalid")<BusinessErrorInit> {}
class DatabaseUnsupported extends TaggedError("coding_business.database_unsupported")<BusinessErrorInit> {}

function businessError(
	reason:
		| "workspace_not_found"
		| "workspace_path_invalid"
		| "workspace_path_conflict"
		| "workspace_unavailable"
		| "session_not_found"
		| "session_file_missing"
		| "session_file_conflict"
		| "session_busy"
		| "storage_inconsistent"
		| "database_invalid"
		| "database_unsupported",
	init: BusinessErrorInit,
) {
	switch (reason) {
		case "workspace_not_found":
			return new WorkspaceNotFound(init);
		case "workspace_path_invalid":
			return new WorkspacePathInvalid(init);
		case "workspace_path_conflict":
			return new WorkspacePathConflict(init);
		case "workspace_unavailable":
			return new WorkspaceUnavailable(init);
		case "session_not_found":
			return new SessionNotFound(init);
		case "session_file_missing":
			return new SessionFileMissing(init);
		case "session_file_conflict":
			return new SessionFileConflict(init);
		case "session_busy":
			return new SessionBusy(init);
		case "storage_inconsistent":
			return new StorageInconsistent(init);
		case "database_invalid":
			return new DatabaseInvalid(init);
		case "database_unsupported":
			return new DatabaseUnsupported(init);
	}
}

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
