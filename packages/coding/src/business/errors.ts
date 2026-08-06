import { TaggedError } from "better-result";

type BusinessErrorInit = {
	readonly cause?: unknown;
	readonly data?: Record<string, unknown>;
	readonly message: string;
};
class ProjectNotFound extends TaggedError("coding_business.project_not_found")<BusinessErrorInit> {}
class ProjectPathInvalid extends TaggedError("coding_business.project_path_invalid")<BusinessErrorInit> {}
class ProjectPathConflict extends TaggedError("coding_business.project_path_conflict")<BusinessErrorInit> {}
class ProjectDirectoryConflict extends TaggedError("coding_business.project_directory_conflict")<BusinessErrorInit> {}
class ProjectUnavailable extends TaggedError("coding_business.project_unavailable")<BusinessErrorInit> {}
class SessionNotFound extends TaggedError("coding_business.session_not_found")<BusinessErrorInit> {}
class SessionFileMissing extends TaggedError("coding_business.session_file_missing")<BusinessErrorInit> {}
class SessionFileConflict extends TaggedError("coding_business.session_file_conflict")<BusinessErrorInit> {}
class SessionBusy extends TaggedError("coding_business.session_busy")<BusinessErrorInit> {}
class StorageInconsistent extends TaggedError("coding_business.storage_inconsistent")<BusinessErrorInit> {}
class DatabaseInvalid extends TaggedError("coding_business.database_invalid")<BusinessErrorInit> {}
class DatabaseUnsupported extends TaggedError("coding_business.database_unsupported")<BusinessErrorInit> {}

function businessError(
	reason:
		| "project_not_found"
		| "project_path_invalid"
		| "project_path_conflict"
		| "project_directory_conflict"
		| "project_unavailable"
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
		case "project_not_found":
			return new ProjectNotFound(init);
		case "project_path_invalid":
			return new ProjectPathInvalid(init);
		case "project_path_conflict":
			return new ProjectPathConflict(init);
		case "project_directory_conflict":
			return new ProjectDirectoryConflict(init);
		case "project_unavailable":
			return new ProjectUnavailable(init);
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

export const projectNotFoundError = (projectId: string) =>
	businessError("project_not_found", {
		message: `Project "${projectId}" does not exist`,
		data: { projectId },
	});

export const projectPathInvalidError = (path: string, cause?: unknown) =>
	businessError("project_path_invalid", {
		message: `Project path is not an accessible directory: ${path}`,
		data: { path },
		cause,
	});

export const projectPathConflictError = (canonicalPath: string, cause?: unknown) =>
	businessError("project_path_conflict", {
		message: `A Project already uses "${canonicalPath}"`,
		data: { canonicalPath },
		cause,
	});

export const projectDirectoryConflictError = (directory: string) =>
	businessError("project_directory_conflict", {
		message: `A Project session directory already uses "${directory}"`,
		data: { directory },
	});

export const projectUnavailableError = (projectId: string, cause?: unknown) =>
	businessError("project_unavailable", {
		message: `Project "${projectId}" must be relinked before local tools can run`,
		data: { projectId },
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
