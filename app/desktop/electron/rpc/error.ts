import { toErrorEnvelope } from "@jai/common";
import type { DesktopAgentCreationFailureReason, DesktopRpcResponse } from "../../shared/desktop-rpc";

export function projectDesktopRpcError(error: unknown): Extract<DesktopRpcResponse, { readonly status: "error" }> {
	const envelope = toErrorEnvelope(error);
	return {
		status: "error",
		error: {
			_tag: envelope.code,
			message: "Desktop request failed.",
			...(safeCreationFailureReason(envelope.code, error) ?? {}),
		},
	};
}

function safeCreationFailureReason(
	code: string,
	data: unknown,
): { readonly reason: DesktopAgentCreationFailureReason } | undefined {
	if (code !== "desktop_agent.creation_failed" || !isRecord(data)) return undefined;
	const reason = data.reason;
	if (
		reason !== "model_unavailable" &&
		reason !== "provider_configuration_invalid" &&
		reason !== "agent_initialization_failed"
	) {
		return undefined;
	}
	return { reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
