export type FileSystemErrorCode =
	| "aborted"
	| "not_found"
	| "permission_denied"
	| "outside_boundary"
	| "not_file"
	| "not_directory"
	| "invalid_path"
	| "conflict"
	| "not_supported"
	| "io_error";

export type FileSearchErrorCode =
	| "aborted"
	| "backend_unavailable"
	| "invalid_pattern"
	| "permission_denied"
	| "outside_boundary"
	| "search_failed";

export type ShellErrorCode =
	| "aborted"
	| "timeout"
	| "shell_unavailable"
	| "spawn_failed"
	| "output_callback_failed"
	| "execution_failed";

export class FileSystemError extends Error {
	readonly code: FileSystemErrorCode;
	readonly resource?: string;
	override readonly cause?: unknown;

	constructor(code: FileSystemErrorCode, message: string, options: { resource?: string; cause?: unknown } = {}) {
		super(message);
		this.name = "FileSystemError";
		this.code = code;
		this.resource = options.resource;
		this.cause = options.cause;
	}
}

export class FileSearchError extends Error {
	readonly code: FileSearchErrorCode;
	readonly resource?: string;
	override readonly cause?: unknown;

	constructor(code: FileSearchErrorCode, message: string, options: { resource?: string; cause?: unknown } = {}) {
		super(message);
		this.name = "FileSearchError";
		this.code = code;
		this.resource = options.resource;
		this.cause = options.cause;
	}
}

export class ShellError extends Error {
	readonly code: ShellErrorCode;
	override readonly cause?: unknown;

	constructor(code: ShellErrorCode, message: string, options: { cause?: unknown } = {}) {
		super(message);
		this.name = "ShellError";
		this.code = code;
		this.cause = options.cause;
	}
}
