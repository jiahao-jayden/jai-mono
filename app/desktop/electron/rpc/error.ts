import { TaggedError } from "better-result";
import type { DesktopFailure, DesktopRpcResponse } from "../../shared/desktop-rpc";

const requestFailed: DesktopFailure = { code: "request.failed", retryable: false };
const transientRequestFailed: DesktopFailure = { code: "request.failed", retryable: true };
const connectionFailed: DesktopFailure = { code: "connection.restart_failed", retryable: true, action: "reconnect" };
const credentialRequired: DesktopFailure = {
	code: "provider.credential_required",
	retryable: false,
	action: "open_provider_settings",
};

/**
 * Every main-process tag that may reach the renderer. A tag missing here is
 * projected as `unknown`, which the parent PRD retrospective audits.
 */
const failuresByTag: Readonly<Record<string, DesktopFailure>> = {
	"desktop_agent.workspace_required": {
		code: "session.workspace_required",
		retryable: false,
		action: "choose_project",
	},
	"desktop_agent.retry_unavailable": { code: "runtime.retry_unavailable", retryable: false },
	"desktop_agent.acp_connection_failed": connectionFailed,
	"desktop_agent.acp_connection_closed": connectionFailed,
	"desktop_agent.acp_request_failed": transientRequestFailed,
	"desktop_agent.session_busy": transientRequestFailed,
	"desktop_agent.session_not_found": requestFailed,
	"desktop_agent.navigation_failed": requestFailed,
	"desktop_agent.factory_unavailable": requestFailed,
	"desktop_agent.unsupported_operation": requestFailed,
	"desktop_provider_config.credential_required": credentialRequired,
	"desktop_provider_config.credential_unavailable": credentialRequired,
	"desktop_provider_config.invalid_input": requestFailed,
	"desktop_session_catalog.project_not_found": requestFailed,
	"desktop_session_catalog.project_path_invalid": {
		code: "session.workspace_required",
		retryable: false,
		action: "choose_project",
	},
	"desktop_session_catalog.project_path_conflict": requestFailed,
	"desktop_session_catalog.session_not_found": requestFailed,
	"desktop_session_catalog.session_busy": transientRequestFailed,
	"desktop_session_catalog.database_invalid": requestFailed,
	"desktop_session_catalog.remote_failed": transientRequestFailed,
	"desktop_session_catalog.session_recovery_failed": transientRequestFailed,
	"desktop_catalog.project_not_found": requestFailed,
	"desktop_catalog.session_not_found": requestFailed,
	"desktop_catalog.project_path_conflict": requestFailed,
	"desktop_catalog.storage_corrupted": requestFailed,
	"desktop_catalog.storage_failed": transientRequestFailed,
	"desktop_catalog_client.invalid_response": requestFailed,
	"desktop_configuration_client.invalid_response": requestFailed,
	"acp_local_client.connect_failed": connectionFailed,
	"acp_local_client.disconnected": connectionFailed,
	"acp_local_client.request_failed": transientRequestFailed,
	"runtime_host_client.launch_failed": connectionFailed,
	"desktop_project.reveal_failed": requestFailed,
	"desktop_logs.open_failed": requestFailed,
	"desktop_project.picker_failed": requestFailed,
	"desktop_workspace.file_unavailable": requestFailed,
	"desktop_artifact.preview_unavailable": requestFailed,
	"desktop_attachment.registration_failed": requestFailed,
	"desktop_terminal.workspace_unavailable": requestFailed,
	"desktop_terminal.not_found": requestFailed,
	"desktop_terminal.spawn_failed": transientRequestFailed,
	"desktop_terminal.operation_failed": transientRequestFailed,
	"workspace_git.unavailable": requestFailed,
	"workspace_git.status_failed": transientRequestFailed,
	"workspace_git.invalid_output": requestFailed,
	"workspace_git.diff_failed": transientRequestFailed,
	"desktop_oauth.callback_server_failed": transientRequestFailed,
	"desktop_oauth.callback_invalid": requestFailed,
	"desktop_oauth.authorization_failed": requestFailed,
	"desktop_theme.invalid_value": requestFailed,
	"desktop_telemetry.invalid_input": requestFailed,
	"desktop_rpc.invalid_input": requestFailed,
	"desktop_rpc.invalid_request": requestFailed,
	"desktop_rpc.method_not_found": requestFailed,
	"desktop_rpc.invalid_response": requestFailed,
};

export function projectDesktopRpcError(error: unknown): Extract<DesktopRpcResponse, { readonly status: "error" }> {
	const tag = TaggedError.is(error) ? error._tag : "error.unknown";
	const failure =
		tag === "desktop_provider_config.model_fetch_failed"
			? modelFetchFailure(error)
			: Object.hasOwn(failuresByTag, tag)
				? failuresByTag[tag]
				: undefined;
	return {
		status: "error",
		error: {
			_tag: tag,
			message: "Desktop request failed.",
			failure: { ...(failure ?? { code: "unknown", retryable: false }) },
		},
	};
}

/** Classifies a model-list request by the endpoint's HTTP status, the only upstream fact that crosses to Desktop. */
function modelFetchFailure(error: unknown): DesktopFailure {
	const data = isRecord(error) && isRecord(error.data) ? error.data : {};
	const status = typeof data.status === "number" ? data.status : undefined;
	const requestId = typeof data.requestId === "string" ? data.requestId : undefined;
	const detail = [status === undefined ? "status=none" : `status=${status}`, requestId && `requestId=${requestId}`]
		.filter(Boolean)
		.join(" ");
	if (status === 401 || status === 403) {
		return { code: "provider.auth_failed", retryable: false, action: "open_provider_settings", detail };
	}
	if (status === 429) return { code: "provider.rate_limited", retryable: true, action: "retry", detail };
	if (status === undefined) return { code: "provider.network", retryable: true, action: "retry", detail };
	if (status >= 500) return { code: "provider.unavailable", retryable: true, action: "retry", detail };
	if (status >= 400) return { code: "provider.invalid_request", retryable: false, detail };
	return { ...transientRequestFailed, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
