import type { JsonValue } from "@jai/agent";
import type { RuntimeHost } from "../../runtime";

export type AcpRequestId = string | number;

export interface AcpJsonRpcRequest {
	readonly jsonrpc: "2.0";
	readonly id?: AcpRequestId;
	readonly method: string;
	readonly params?: unknown;
}

export interface AcpJsonRpcResponse {
	readonly jsonrpc: "2.0";
	/** JSON-RPC requires `null` for parse/invalid-request errors with no usable id. */
	readonly id: AcpRequestId | null;
	readonly result?: unknown;
	readonly error?: { readonly code: number; readonly message: string };
}

export interface AcpJsonRpcNotification {
	readonly jsonrpc: "2.0";
	readonly method: string;
	readonly params: unknown;
}

export type AcpOutboundMessage = AcpJsonRpcResponse | AcpJsonRpcNotification;
export type AcpNotificationSink = (notification: AcpJsonRpcNotification) => void;

/**
 * One agent-to-client JSON-RPC request. An unavailable connection resolves as
 * `undefined`: interaction callers must choose their safe default rather than
 * learn transport failures.
 */
export interface AcpClientRequestSink {
	request(method: string, params: unknown): Promise<unknown | undefined>;
}

export interface AcpImplementationInfo {
	readonly name: string;
	readonly title?: string;
	readonly version: string;
}

export type AcpPromptBlock =
	| { readonly type: "text"; readonly text: string }
	| { readonly type: "resource_link"; readonly uri: string; readonly name?: string; readonly title?: string | null };

export interface AcpV2AgentOptions {
	readonly host: RuntimeHost;
	readonly info: AcpImplementationInfo;
	readonly notificationSink?: AcpNotificationSink;
	/** Reverse-request seam for ACP interactions such as `session/request_permission`. */
	readonly clientRequestSink?: AcpClientRequestSink;
}

export interface AcpV2Agent {
	handle(request: AcpJsonRpcRequest): Promise<readonly AcpOutboundMessage[]>;
	/** Drains notifications produced after a prior request returned. */
	drain(): readonly AcpJsonRpcNotification[];
	close(): Promise<void>;
}

export type AcpPromptMetadata = Readonly<Record<string, JsonValue>>;
