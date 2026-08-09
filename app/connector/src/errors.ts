import { TaggedError } from "better-result";

export class ConnectorActionNotFound extends TaggedError("connector.action_not_found")<{
	readonly data: { readonly actionId: string };
	readonly message: string;
}> {}

export class ConnectorConnectionNotFound extends TaggedError("connector.connection_not_found")<{
	readonly data: { readonly connectorId: string };
	readonly message: string;
}> {}

export class ConnectorConnectionUnavailable extends TaggedError("connector.connection_unavailable")<{
	readonly data: { readonly connectorId: string; readonly status: string };
	readonly message: string;
}> {}

export class ConnectorInputInvalid extends TaggedError("connector.input_invalid")<{
	readonly data: { readonly actionId: string; readonly reason: string };
	readonly message: string;
}> {}

export class ConnectorPolicyDenied extends TaggedError("connector.policy_denied")<{
	readonly data: { readonly actionId: string; readonly policy: "hidden" | "deny" };
	readonly message: string;
}> {}

export class ConnectorApprovalInvalid extends TaggedError("connector.approval_invalid")<{
	readonly data: { readonly actionId: string; readonly reason: "missing" | "expired" | "replayed" | "mismatch" };
	readonly message: string;
}> {}

export class ConnectorSessionRequired extends TaggedError("connector.session_required")<{
	readonly data: { readonly actionId: string };
	readonly message: string;
}> {}

export class ConnectorUpstreamFailed extends TaggedError("connector.upstream_failed")<{
	readonly cause?: unknown;
	readonly data: {
		readonly connectorId: string;
		readonly actionId: string;
		readonly status?: number;
		readonly retryAfterMs?: number;
	};
	readonly message: string;
}> {}

export class ConnectorUpstreamRateLimited extends TaggedError("connector.upstream_rate_limited")<{
	readonly data: { readonly connectorId: string; readonly actionId: string; readonly retryAfterMs?: number };
	readonly message: string;
}> {}

export class ConnectorUpstreamUnavailable extends TaggedError("connector.upstream_unavailable")<{
	readonly cause?: unknown;
	readonly data: { readonly connectorId: string; readonly actionId: string; readonly status?: number };
	readonly message: string;
}> {}

export class ConnectorRequestCancelled extends TaggedError("connector.request_cancelled")<{
	readonly data: { readonly requestId: string };
	readonly message: string;
}> {}

export class ConnectorProtocolInvalid extends TaggedError("connector.protocol_invalid")<{
	readonly cause?: unknown;
	readonly data: { readonly reason: string };
	readonly message: string;
}> {}

export class ConnectorOAuthGatewayFailed extends TaggedError("connector.oauth_gateway_failed")<{
	readonly cause?: unknown;
	readonly data: {
		readonly oauthServiceId: string;
		readonly operation: "token" | "refresh" | "revoke";
		readonly status?: number;
		readonly code?: string;
	};
	readonly message: string;
}> {}

export class ConnectorOAuthFlowInvalid extends TaggedError("connector.oauth_flow_invalid")<{
	readonly data: { readonly oauthServiceId: string; readonly reason: "expired" | "missing" | "mismatch" };
	readonly message: string;
}> {}

export class ConnectorConfigReadFailed extends TaggedError("connector.config_read_failed")<{
	readonly cause?: unknown;
	readonly data: { readonly path?: string; readonly reason: string };
	readonly message: string;
}> {}

export class ConnectorConfigWriteFailed extends TaggedError("connector.config_write_failed")<{
	readonly cause?: unknown;
	readonly data: { readonly path?: string; readonly reason: string };
	readonly message: string;
}> {}

export class ConnectorConfigConflict extends TaggedError("connector.config_conflict")<{
	readonly data: { readonly expectedRevision: string | null; readonly actualRevision: string | null };
	readonly message: string;
}> {}
