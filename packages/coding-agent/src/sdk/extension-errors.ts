import { TaggedError } from "better-result";

type ExtensionErrorInit = {
	readonly message: string;
	readonly extensionId?: string;
	readonly catalogId?: string;
	readonly hook?: string;
	readonly operation?:
		| "configuration_read"
		| "configuration_write"
		| "approval"
		| "session_state_read"
		| "session_state_write";
	readonly reason?: string;
	readonly cause?: unknown;
};

/** Returned by an Extension when its own lifecycle or catalog operation cannot complete. */
export class CodingExtensionOperationFailed extends TaggedError("coding_extension.operation_failed")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class CodingExtensionActivationFailed extends TaggedError(
	"coding_extension.activation_failed",
)<ExtensionErrorInit> {}
export class CodingExtensionCatalogDiscoveryFailed extends TaggedError(
	"coding_extension.catalog_discovery_failed",
)<ExtensionErrorInit> {}
export class CodingExtensionCapabilityConflict extends TaggedError(
	"coding_extension.capability_conflict",
)<ExtensionErrorInit> {}
export class CodingExtensionContractViolation extends TaggedError(
	"coding_extension.contract_violation",
)<ExtensionErrorInit> {}
export class CodingExtensionConfigurationUnavailable extends TaggedError(
	"coding_extension.configuration_unavailable",
)<ExtensionErrorInit> {}
export class CodingExtensionSessionStateUnavailable extends TaggedError(
	"coding_extension.session_state_unavailable",
)<ExtensionErrorInit> {}
export class CodingExtensionPersistentApprovalUnavailable extends TaggedError(
	"coding_extension.persistent_approval_unavailable",
)<ExtensionErrorInit> {}
export class CodingExtensionApprovalAborted extends TaggedError(
	"coding_extension.approval_aborted",
)<ExtensionErrorInit> {}
export class CodingExtensionHostOperationFailed extends TaggedError(
	"coding_extension.host_operation_failed",
)<ExtensionErrorInit> {}
export class CodingExtensionHookFailed extends TaggedError("coding_extension.hook_failed")<ExtensionErrorInit> {}
export class CodingExtensionDeactivationFailed extends TaggedError(
	"coding_extension.deactivation_failed",
)<ExtensionErrorInit> {}
export class CodingExtensionPolicyBlocked extends TaggedError("coding_extension.policy_blocked")<ExtensionErrorInit> {}

export type CodingExtensionError =
	| CodingExtensionActivationFailed
	| CodingExtensionCatalogDiscoveryFailed
	| CodingExtensionCapabilityConflict
	| CodingExtensionContractViolation
	| CodingExtensionConfigurationUnavailable
	| CodingExtensionSessionStateUnavailable
	| CodingExtensionPersistentApprovalUnavailable
	| CodingExtensionApprovalAborted
	| CodingExtensionHostOperationFailed
	| CodingExtensionHookFailed
	| CodingExtensionDeactivationFailed
	| CodingExtensionPolicyBlocked;

export function extensionActivationFailed(extensionId: string, cause: CodingExtensionOperationFailed) {
	return new CodingExtensionActivationFailed({
		extensionId,
		message: `Extension "${extensionId}" activation failed: ${cause.message}`,
		cause,
	});
}

export function extensionOperationFailed(cause: unknown, fallbackMessage: string) {
	return new CodingExtensionOperationFailed({
		message: cause instanceof Error && cause.message ? cause.message : fallbackMessage,
		cause,
	});
}

export function extensionCatalogDiscoveryFailed(
	extensionId: string,
	catalogId: string,
	cause: CodingExtensionOperationFailed,
) {
	return new CodingExtensionCatalogDiscoveryFailed({
		extensionId,
		catalogId,
		message: `Extension "${extensionId}" catalog "${catalogId}" discovery failed: ${cause.message}`,
		cause,
	});
}

export function extensionCapabilityConflict(kind: string, name: string) {
	return new CodingExtensionCapabilityConflict({
		reason: kind,
		message: `Extension ${kind} "${name}" conflicts with an existing capability`,
	});
}

export function extensionContractViolation(init: ExtensionErrorInit) {
	return new CodingExtensionContractViolation(init);
}

export function extensionHostOperationFailed(
	operation: NonNullable<ExtensionErrorInit["operation"]>,
	message: string,
	cause?: unknown,
) {
	return new CodingExtensionHostOperationFailed({ operation, message, cause });
}

export function extensionHookFailed(extensionId: string, hook: string, cause: unknown) {
	return new CodingExtensionHookFailed({
		extensionId,
		hook,
		message: `Extension "${extensionId}" ${hook} hook failed`,
		cause,
	});
}
