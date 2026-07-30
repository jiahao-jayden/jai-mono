import { defineCodedError, type JsonValue } from "@jai/common";

export type AgentExtensionFailureReason =
	| "duplicate_extension_name"
	| "extension_already_owned"
	| "read_tools_failed"
	| "duplicate_tool_name"
	| "initialize_failed";

export interface AgentExtensionFailure {
	readonly reason: AgentExtensionFailureReason;
	readonly extension?: string;
	readonly tool?: string;
	readonly source?: string;
	readonly message: string;
}

export interface AgentExtensionInitializationErrorData {
	readonly failures: readonly AgentExtensionFailure[];
}

const extensionError = defineCodedError("agent_extension", [
	"preflight_failed",
	"initialization_failed",
	"hooks_registration_closed",
	"initialization_reentrancy",
] as const);

export function extensionPreflightError(failures: readonly AgentExtensionFailure[], causes: readonly unknown[]) {
	return extensionError("preflight_failed", {
		message: "AgentExtension preflight failed",
		data: toErrorData(failures),
		cause: causes.length > 0 ? new AggregateError(causes, "AgentExtension preflight failed") : undefined,
	});
}

export function extensionInitializationError(failures: readonly AgentExtensionFailure[], causes: readonly unknown[]) {
	return extensionError("initialization_failed", {
		message: "AgentExtension initialization failed",
		data: toErrorData(failures),
		cause: new AggregateError(causes, "AgentExtension initialization failed"),
	});
}

export function hooksRegistrationClosedError(extension?: string) {
	return extensionError("hooks_registration_closed", {
		message: extension
			? `AgentExtension "${extension}" can register hooks only while its initialize() method is running`
			: "Hooks can be registered only by the AgentExtension currently being initialized",
	});
}

export function extensionInitializationReentrancyError(extension: string) {
	return extensionError("initialization_reentrancy", {
		message: `AgentExtension "${extension}" cannot run the Agent from inside initialize()`,
	});
}

function toErrorData(failures: readonly AgentExtensionFailure[]): JsonValue {
	return {
		failures: failures.map((failure) => {
			const output: Record<string, JsonValue> = {
				reason: failure.reason,
				message: failure.message,
			};
			if (failure.extension !== undefined) output.extension = failure.extension;
			if (failure.tool !== undefined) output.tool = failure.tool;
			if (failure.source !== undefined) output.source = failure.source;
			return output;
		}),
	};
}
