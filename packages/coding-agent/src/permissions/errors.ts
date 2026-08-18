import { TaggedError } from "better-result";

class InvalidPermissionRule extends TaggedError("coding_permission.invalid_rule")<{
	readonly message: string;
	readonly rule: string;
}> {}

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

class DuplicatePermissionRequest extends TaggedError("coding_permission.duplicate_request")<{
	readonly message: string;
	readonly requestId: string;
}> {}

class PermissionRequestNotFound extends TaggedError("coding_permission.request_not_found")<{
	readonly message: string;
	readonly requestId: string;
}> {}

class PermissionRegistryClosed extends TaggedError("coding_permission.registry_closed")<{
	readonly message: string;
}> {}

export function invalidPermissionRuleError(rule: string, message: string) {
	return new InvalidPermissionRule({
		message,
		rule,
	});
}

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

export function duplicatePermissionRequestError(requestId: string) {
	return new DuplicatePermissionRequest({
		message: `Permission request already exists: ${requestId}`,
		requestId,
	});
}

export function permissionRequestNotFoundError(requestId: string) {
	return new PermissionRequestNotFound({
		message: `Permission request is missing or already resolved: ${requestId}`,
		requestId,
	});
}

export function permissionRegistryClosedError() {
	return new PermissionRegistryClosed({
		message: "Permission approval registry is closed",
	});
}
