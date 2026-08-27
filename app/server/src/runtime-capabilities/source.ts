import type { CodingAgentCreateOptions, CodingAgentFileCapabilities } from "@jai/coding-agent";
import type { Result } from "better-result";
import { TaggedError } from "better-result";

/** Capabilities selected by a Host for exactly one Runtime Operation. */
export interface RuntimeCapabilityAssembly {
	readonly fileCapabilities: CodingAgentFileCapabilities;
	readonly extensions: NonNullable<CodingAgentCreateOptions["extensions"]>;
}

/** Stable Operation input that a capability source may use to select Host-owned resources. */
export interface RuntimeCapabilitySourceInput {
	readonly sessionId: string;
	readonly operationId: string;
	readonly cwd: string;
}

export class RuntimeCapabilitySourceFailed extends TaggedError("runtime_capabilities.resolve_failed")<{
	readonly sessionId: string;
	readonly operationId: string;
	readonly message: string;
	readonly cause?: unknown;
}> {}

/**
 * Host-owned selector for local or remote Coding Agent capabilities. It owns
 * no durable data and its returned values live for only one Operation.
 */
export interface RuntimeCapabilitySource {
	resolve(
		input: RuntimeCapabilitySourceInput,
	): Promise<Result<RuntimeCapabilityAssembly, RuntimeCapabilitySourceFailed>>;
}
