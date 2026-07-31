import { defineCodedError } from "@jai/common";

const permissionError = defineCodedError("coding_permission", [
	"invalid_rule",
	"invalid_call",
	"denied",
	"approval_unavailable",
	"aborted",
] as const);

export function invalidPermissionRuleError(rule: string, message: string) {
	return permissionError("invalid_rule", {
		message,
		data: { rule },
	});
}

export function invalidPermissionCallError(toolName: string, message: string) {
	return permissionError("invalid_call", {
		message,
		data: { toolName },
	});
}

export function permissionDeniedError(toolName: string, reason: string) {
	return permissionError("denied", {
		message: `Permission denied for ${toolName}: ${reason}`,
		data: { toolName, reason },
	});
}

export function permissionApprovalUnavailableError(toolName: string) {
	return permissionError("approval_unavailable", {
		message: `Permission approval is unavailable for ${toolName}`,
		data: { toolName },
	});
}

export function permissionAbortedError(toolName: string) {
	return permissionError("aborted", {
		message: `Permission request aborted for ${toolName}`,
		data: { toolName },
	});
}
