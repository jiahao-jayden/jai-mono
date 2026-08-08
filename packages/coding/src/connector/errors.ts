import { TaggedError } from "better-result";

export class ConnectorAgentToolFailed extends TaggedError("coding.connector_tool_failed")<{
	readonly cause?: unknown;
	readonly data: { readonly toolName: string; readonly code?: string };
	readonly message: string;
}> {}

export class ConnectorAgentApprovalDenied extends TaggedError("coding.connector_approval_denied")<{
	readonly data: { readonly actionId: string };
	readonly message: string;
}> {}

export class ConnectorAgentConfigurationInvalid extends TaggedError("coding.connector_configuration_invalid")<{
	readonly data: { readonly reason: string };
	readonly message: string;
}> {}
