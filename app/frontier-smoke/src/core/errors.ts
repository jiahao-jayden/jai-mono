import { TaggedError } from "better-result";

export class FrontierTaskInvalid extends TaggedError("frontier_smoke.task_invalid")<{
	readonly message: string;
}> {}

export class FrontierConstraintUnsupported extends TaggedError("frontier_smoke.constraint_unsupported")<{
	readonly message: string;
}> {}

export class FrontierProviderUnavailable extends TaggedError("frontier_smoke.provider_unavailable")<{
	readonly message: string;
}> {}

export class FrontierDockerUnavailable extends TaggedError("frontier_smoke.docker_unavailable")<{
	readonly message: string;
}> {}

export class FrontierDockerOperationFailed extends TaggedError("frontier_smoke.docker_operation_failed")<{
	readonly action: string;
	readonly message: string;
}> {}

export class FrontierGatewayUnhealthy extends TaggedError("frontier_smoke.gateway_unhealthy")<{
	readonly message: string;
}> {}

export class FrontierOutputUnavailable extends TaggedError("frontier_smoke.output_unavailable")<{
	readonly message: string;
}> {}

export type FrontierSmokeError =
	| FrontierTaskInvalid
	| FrontierConstraintUnsupported
	| FrontierProviderUnavailable
	| FrontierDockerUnavailable
	| FrontierDockerOperationFailed
	| FrontierGatewayUnhealthy
	| FrontierOutputUnavailable;

/** Safe for terminal and result DTOs: never projects stack, cause, or provider payloads. */
export function frontierErrorMessage(error: unknown): string {
	if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
		return error.message;
	}
	return "An unknown Frontier smoke failure occurred";
}
