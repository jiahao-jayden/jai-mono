import { getErrorCode } from "@jai/common";

/** Node、Bun 或 IPC 还原后的 errno 都按结构而非原型识别。 */
export function isNodeErrorCode(error: unknown, code: string): boolean {
	return getErrorCode(error) === code;
}

export function isNotFound(error: unknown): boolean {
	return isNodeErrorCode(error, "ENOENT");
}

export function isPermissionDenied(error: unknown): boolean {
	return isNodeErrorCode(error, "EACCES") || isNodeErrorCode(error, "EPERM");
}
