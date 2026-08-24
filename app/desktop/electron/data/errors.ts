import { TaggedError } from "better-result";

type BusinessErrorInit = {
	readonly cause?: unknown;
	readonly data?: Record<string, unknown>;
	readonly message: string;
};
class ProjectNotFound extends TaggedError("coding_business.project_not_found")<BusinessErrorInit> {}
class ProjectPathInvalid extends TaggedError("coding_business.project_path_invalid")<BusinessErrorInit> {}
class ProjectPathConflict extends TaggedError("coding_business.project_path_conflict")<BusinessErrorInit> {}
class SessionNotFound extends TaggedError("coding_business.session_not_found")<BusinessErrorInit> {}
class SessionBusy extends TaggedError("coding_business.session_busy")<BusinessErrorInit> {}
class DatabaseInvalid extends TaggedError("coding_business.database_invalid")<BusinessErrorInit> {}

function businessError(
	reason:
		| "project_not_found"
		| "project_path_invalid"
		| "project_path_conflict"
		| "session_not_found"
		| "session_busy"
		| "database_invalid",
	init: BusinessErrorInit,
) {
	switch (reason) {
		case "project_not_found":
			return new ProjectNotFound(init);
		case "project_path_invalid":
			return new ProjectPathInvalid(init);
		case "project_path_conflict":
			return new ProjectPathConflict(init);
		case "session_not_found":
			return new SessionNotFound(init);
		case "session_busy":
			return new SessionBusy(init);
		case "database_invalid":
			return new DatabaseInvalid(init);
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

export const sessionNotFoundError = (sessionId: string) =>
	businessError("session_not_found", {
		message: `Session "${sessionId}" does not exist`,
		data: { sessionId },
	});

export const sessionBusyError = (sessionId: string, cause?: unknown) =>
	businessError("session_busy", {
		message: `Session "${sessionId}" is busy`,
		data: { sessionId },
		cause,
	});

export const databaseInvalidError = (message: string) =>
	businessError("database_invalid", {
		message,
	});
