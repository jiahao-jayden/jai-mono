import { CodedError } from "@jai/common";

export type FileSystemErrorReason =
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

export type FileSearchErrorReason =
	| "aborted"
	| "backend_unavailable"
	| "invalid_pattern"
	| "permission_denied"
	| "outside_boundary"
	| "search_failed";

export type ShellErrorReason =
	| "aborted"
	| "timeout"
	| "shell_unavailable"
	| "spawn_failed"
	| "output_callback_failed"
	| "execution_failed";

export type FileSystemErrorCode = `filesystem.${FileSystemErrorReason}`;
export type FileSearchErrorCode = `filesearch.${FileSearchErrorReason}`;
export type ShellErrorCode = `shell.${ShellErrorReason}`;

export class FileSystemError extends CodedError<FileSystemErrorCode, { resource?: string }> {
	readonly reason: FileSystemErrorReason;
	readonly resource?: string;

	constructor(reason: FileSystemErrorReason, message: string, options: { resource?: string; cause?: unknown } = {}) {
		super({
			code: `filesystem.${reason}`,
			message,
			data: { resource: options.resource },
			cause: options.cause,
		});
		this.name = "FileSystemError";
		this.reason = reason;
		this.resource = options.resource;
	}
}

export class FileSearchError extends CodedError<FileSearchErrorCode, { resource?: string }> {
	readonly reason: FileSearchErrorReason;
	readonly resource?: string;

	constructor(reason: FileSearchErrorReason, message: string, options: { resource?: string; cause?: unknown } = {}) {
		super({
			code: `filesearch.${reason}`,
			message,
			data: { resource: options.resource },
			cause: options.cause,
		});
		this.name = "FileSearchError";
		this.reason = reason;
		this.resource = options.resource;
	}
}

export class ShellError extends CodedError<ShellErrorCode> {
	readonly reason: ShellErrorReason;

	constructor(reason: ShellErrorReason, message: string, options: { cause?: unknown } = {}) {
		super({ code: `shell.${reason}`, message, cause: options.cause });
		this.name = "ShellError";
		this.reason = reason;
	}
}
