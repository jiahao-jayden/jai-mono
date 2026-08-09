import { getErrorCode, getErrorMessage } from "@jai/common";
import { TaggedError } from "better-result";
import { ConnectorRemoteFailure } from "../errors";
import type { ConnectorFailure, JsonValue } from "../types";

export const CONNECTOR_PROTOCOL_VERSION = 1 as const;

export interface ConnectorErrorDto {
	readonly code: string;
	readonly message: string;
	readonly retryable: boolean;
	readonly actionId?: string;
	readonly providerId?: string;
	readonly requestId?: string;
	readonly userAction?: "none" | "retry" | "open_connector_settings" | "reauthorize_connection" | "approve_action";
	readonly retryAfterMs?: number;
	readonly details?: JsonValue;
}

export interface WireSuccess<T> {
	readonly protocolVersion: typeof CONNECTOR_PROTOCOL_VERSION;
	readonly requestId: string;
	readonly ok: true;
	readonly value: T;
}

export interface WireFailure {
	readonly protocolVersion: typeof CONNECTOR_PROTOCOL_VERSION;
	readonly requestId: string;
	readonly ok: false;
	readonly error: ConnectorErrorDto;
}

export type WireResponse<T> = WireSuccess<T> | WireFailure;

export function successResponse<T>(requestId: string, value: T): WireSuccess<T> {
	return { protocolVersion: CONNECTOR_PROTOCOL_VERSION, requestId, ok: true, value };
}

export function failureResponse(requestId: string, error: unknown): WireFailure {
	return {
		protocolVersion: CONNECTOR_PROTOCOL_VERSION,
		requestId,
		ok: false,
		error: toConnectorErrorDto(error, requestId),
	};
}

export function toConnectorErrorDto(error: unknown, requestId?: string): ConnectorErrorDto {
	const code = getErrorCode(error) ?? "error.unknown";
	const data = TaggedError.is(error) && "data" in error && isJsonValue(error.data) ? error.data : undefined;
	const record = isRecord(data) ? data : undefined;
	const message = wireMessage(code, error);
	const details = projectDetails(code, record);
	return {
		code,
		message,
		retryable: isRetryableCode(code),
		...(requestId ? { requestId } : {}),
		...(typeof record?.actionId === "string" ? { actionId: record.actionId } : {}),
		...(typeof record?.providerId === "string" ? { providerId: record.providerId } : {}),
		...(code === "connector.connection_unavailable" ? { userAction: "reauthorize_connection" as const } : {}),
		...(code === "connector.approval_invalid" ? { userAction: "approve_action" as const } : {}),
		...(isRetryAfterCode(code) && typeof record?.retryAfterMs === "number"
			? { retryAfterMs: record.retryAfterMs }
			: {}),
		...(details ? { details } : {}),
	};
}

export function isWireResponse(value: unknown): value is WireResponse<unknown> {
	if (!isRecord(value)) return false;
	if (value.protocolVersion !== CONNECTOR_PROTOCOL_VERSION || typeof value.requestId !== "string") return false;
	if (value.ok === true) return "value" in value;
	return value.ok === false && isErrorDto(value.error);
}

export function remoteError(error: ConnectorErrorDto): ConnectorFailure {
	return new ConnectorRemoteFailure({
		message: error.message,
		data: { code: error.code, remoteMessage: error.message },
	});
}

function isRetryableCode(code: string): boolean {
	return new Set([
		"connector.service_unavailable",
		"connector.provider_failed",
		"connector.provider_unavailable",
		"connector.request_cancelled",
		"connector.provider_rate_limited",
	]).has(code);
}

function isRetryAfterCode(code: string): boolean {
	return code === "connector.provider_failed" || code === "connector.provider_rate_limited";
}

function wireMessage(code: string, error: unknown): string {
	if (code === "connector.provider_failed") return "Connector provider request failed";
	if (code === "connector.provider_unavailable") return "Connector provider is unavailable";
	if (code === "connector.provider_rate_limited") return "Connector provider rate limit exceeded";
	if (code === "connector.remote_failure") return "Remote Connector request failed";
	return code === "error.unknown" ? "Connector request failed" : getErrorMessage(error);
}

function projectDetails(code: string, record: Record<string, unknown> | undefined): JsonValue | undefined {
	if (!record) return undefined;
	const fields: readonly string[] = (() => {
		switch (code) {
			case "connector.action_not_found":
			case "connector.input_invalid":
			case "connector.policy_denied":
			case "connector.approval_invalid":
			case "connector.session_required":
				return ["actionId", "reason", "policy"];
			case "connector.connection_not_found":
				return ["providerId"];
			case "connector.connection_unavailable":
				return ["providerId", "status"];
			case "connector.provider_failed":
			case "connector.provider_rate_limited":
			case "connector.provider_unavailable":
				return ["providerId", "actionId", "status", "retryAfterMs"];
			case "connector.request_cancelled":
			case "connector.unauthorized":
				return ["requestId"];
			case "connector.config_conflict":
				return ["expectedRevision", "actualRevision"];
			default:
				return [];
		}
	})();
	const projected = Object.fromEntries(
		fields.flatMap((field) => {
			const value = record[field];
			return value === undefined || !isJsonValue(value) ? [] : [[field, value]];
		}),
	);
	return Object.keys(projected).length > 0 ? projected : undefined;
}

function isErrorDto(value: unknown): value is ConnectorErrorDto {
	return (
		isRecord(value) &&
		typeof value.code === "string" &&
		typeof value.message === "string" &&
		typeof value.retryable === "boolean"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string")
		return true;
	if (Array.isArray(value)) return value.every(isJsonValue);
	return isRecord(value) && Object.values(value).every(isJsonValue);
}
