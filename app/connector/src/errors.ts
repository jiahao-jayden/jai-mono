import { TaggedError } from "better-result";

export class ConnectorActionNotFound extends TaggedError("connector.action_not_found")<{
	readonly data: { readonly actionId: string };
	readonly message: string;
}> {}

export class ConnectorConnectionNotFound extends TaggedError("connector.connection_not_found")<{
	readonly data: { readonly providerId: string; readonly alias?: string };
	readonly message: string;
}> {}

export class ConnectorConnectionUnavailable extends TaggedError("connector.connection_unavailable")<{
	readonly data: { readonly alias: string; readonly status: string };
	readonly message: string;
}> {}

export class ConnectorInputInvalid extends TaggedError("connector.input_invalid")<{
	readonly data: { readonly actionId: string; readonly reason: string };
	readonly message: string;
}> {}

export class ConnectorPolicyDenied extends TaggedError("connector.policy_denied")<{
	readonly data: { readonly actionId: string; readonly policy: "hidden" | "blocked" };
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

export class ConnectorProviderFailed extends TaggedError("connector.provider_failed")<{
	readonly cause?: unknown;
	readonly data: {
		readonly providerId: string;
		readonly actionId: string;
		readonly status?: number;
		readonly retryAfterMs?: number;
	};
	readonly message: string;
}> {}

export class ConnectorProviderRateLimited extends TaggedError("connector.provider_rate_limited")<{
	readonly data: { readonly providerId: string; readonly actionId: string; readonly retryAfterMs?: number };
	readonly message: string;
}> {}

export class ConnectorProviderUnavailable extends TaggedError("connector.provider_unavailable")<{
	readonly cause?: unknown;
	readonly data: { readonly providerId: string; readonly actionId: string; readonly status?: number };
	readonly message: string;
}> {}

export class ConnectorRequestCancelled extends TaggedError("connector.request_cancelled")<{
	readonly data: { readonly requestId: string };
	readonly message: string;
}> {}

export class ConnectorUnauthorized extends TaggedError("connector.unauthorized")<{
	readonly data: { readonly requestId: string };
	readonly message: string;
}> {}

export class ConnectorProtocolInvalid extends TaggedError("connector.protocol_invalid")<{
	readonly data: { readonly reason: string };
	readonly message: string;
}> {}

export class ConnectorServiceUnavailable extends TaggedError("connector.service_unavailable")<{
	readonly cause?: unknown;
	readonly data: { readonly endpoint: string };
	readonly message: string;
}> {}

export class ConnectorRemoteFailure extends TaggedError("connector.remote_failure")<{
	readonly data: { readonly code: string; readonly remoteMessage: string };
	readonly message: string;
}> {}

export class ConnectorRuntimeConfigInvalid extends TaggedError("connector.runtime_config_invalid")<{
	readonly cause?: unknown;
	readonly data: { readonly reason: string; readonly path?: string };
	readonly message: string;
}> {}

export class ConnectorRuntimeLockUnavailable extends TaggedError("connector.runtime_lock_unavailable")<{
	readonly data: { readonly lockFile: string };
	readonly message: string;
}> {}

export class ConnectorRuntimeDiscoveryInvalid extends TaggedError("connector.runtime_discovery_invalid")<{
	readonly cause?: unknown;
	readonly data: { readonly discoveryFile: string; readonly reason: string };
	readonly message: string;
}> {}

export class ConnectorRuntimeUnavailable extends TaggedError("connector.runtime_unavailable")<{
	readonly cause?: unknown;
	readonly data: { readonly reason: string };
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
