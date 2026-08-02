import { TaggedError } from "better-result";

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

export function fileSystemError(
	reason: FileSystemErrorReason,
	message: string,
	options: { resource?: string; cause?: unknown } = {},
) {
	const ErrorType = TaggedError(`filesystem.${reason}` as FileSystemErrorCode)<{
		readonly cause?: unknown;
		readonly data: { readonly resource?: string };
		readonly message: string;
	}>;
	return new ErrorType({ message, data: { resource: options.resource }, cause: options.cause });
}

export function fileSearchError(
	reason: FileSearchErrorReason,
	message: string,
	options: { resource?: string; cause?: unknown } = {},
) {
	const ErrorType = TaggedError(`filesearch.${reason}` as FileSearchErrorCode)<{
		readonly cause?: unknown;
		readonly data: { readonly resource?: string };
		readonly message: string;
	}>;
	return new ErrorType({ message, data: { resource: options.resource }, cause: options.cause });
}

export function shellError(reason: ShellErrorReason, message: string, options: { cause?: unknown } = {}) {
	const ErrorType = TaggedError(`shell.${reason}` as ShellErrorCode)<{
		readonly cause?: unknown;
		readonly message: string;
	}>;
	return new ErrorType({ message, cause: options.cause });
}
