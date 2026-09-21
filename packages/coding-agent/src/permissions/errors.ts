import { TaggedError } from "better-result";

class InvalidPermissionCall extends TaggedError("coding_permission.invalid_call")<{
	readonly message: string;
	readonly toolName: string;
}> {}

class PermissionDenied extends TaggedError("coding_permission.denied")<{
	readonly message: string;
	readonly reason: string;
	readonly toolName: string;
}> {}

class PermissionApprovalUnavailable extends TaggedError("coding_permission.approval_unavailable")<{
	readonly message: string;
	readonly toolName: string;
}> {}

class PermissionAborted extends TaggedError("coding_permission.aborted")<{
	readonly message: string;
	readonly toolName: string;
}> {}

class PermissionGrantSaveFailed extends TaggedError("coding_permission.grant_save_failed")<{
	readonly message: string;
	readonly toolName: string;
	readonly scope: "project";
	readonly cause?: unknown;
}> {}

class ExecutionPolicyUnsupported extends TaggedError("coding_execution_policy.unsupported_policy")<{
	readonly action: "file.read" | "file.write";
	readonly message: string;
	readonly pattern: string;
}> {}

export function invalidPermissionCallError(toolName: string, message: string) {
	return new InvalidPermissionCall({
		message,
		toolName,
	});
}

export function permissionDeniedError(toolName: string, reason: string) {
	return new PermissionDenied({
		message: `Permission denied for ${toolName}: ${reason}`,
		toolName,
		reason,
	});
}

export function permissionApprovalUnavailableError(toolName: string) {
	return new PermissionApprovalUnavailable({
		message: `Permission approval is unavailable for ${toolName}`,
		toolName,
	});
}

export function permissionAbortedError(toolName: string) {
	return new PermissionAborted({
		message: `Permission request aborted for ${toolName}`,
		toolName,
	});
}

export function permissionGrantSaveFailedError(toolName: string, cause?: unknown) {
	return new PermissionGrantSaveFailed({
		message: `Could not save project permission grant for ${toolName}`,
		toolName,
		scope: "project",
		...(cause === undefined ? {} : { cause }),
	});
}

export function executionPolicyUnsupportedError(action: "file.read" | "file.write", pattern: string, message: string) {
	return new ExecutionPolicyUnsupported({ action, pattern, message });
}
