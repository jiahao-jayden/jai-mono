import { toErrorEnvelope } from "@jai/common";
import { Value } from "@sinclair/typebox/value";
import { TaggedError } from "better-result";
import { type IpcMainInvokeEvent, ipcMain } from "electron";
import {
	DESKTOP_RPC_CHANNEL,
	type DesktopRpcRequest,
	type DesktopRpcResponse,
	desktopRpcRequestSchema,
	jsonValueSchema,
} from "../../shared/desktop-rpc";
import type { DesktopRouter } from "./router";

type RpcErrorInit = { readonly data?: { readonly path: string }; readonly message: string };
class InvalidRpcRequest extends TaggedError("desktop_rpc.invalid_request")<RpcErrorInit> {}
class RpcMethodNotFound extends TaggedError("desktop_rpc.method_not_found")<RpcErrorInit> {}
class InvalidRpcResponse extends TaggedError("desktop_rpc.invalid_response")<RpcErrorInit> {}

function rpcError(reason: "invalid_request" | "method_not_found" | "invalid_response", init: RpcErrorInit) {
	switch (reason) {
		case "invalid_request":
			return new InvalidRpcRequest(init);
		case "method_not_found":
			return new RpcMethodNotFound(init);
		case "invalid_response":
			return new InvalidRpcResponse(init);
	}
}

export function registerDesktopRpc(router: DesktopRouter): void {
	ipcMain.handle(DESKTOP_RPC_CHANNEL, async (event, request: unknown): Promise<DesktopRpcResponse> => {
		try {
			const parsed = parseRequest(request);
			const handler = resolveHandler(router, parsed.path);
			const value = await handler(event, ...parsed.args);
			if (value === undefined) return { status: "ok" };
			if (!Value.Check(jsonValueSchema, value)) {
				throw rpcError("invalid_response", {
					message: `Desktop method "${parsed.path}" returned a non-JSON value`,
					data: { path: parsed.path },
				});
			}
			return { status: "ok", value };
		} catch (error) {
			const envelope = toErrorEnvelope(error);
			return {
				status: "error",
				error:
					"data" in envelope
						? { _tag: envelope.code, message: envelope.message, data: envelope.data }
						: { _tag: envelope.code, message: envelope.message },
			};
		}
	});
}

function parseRequest(value: unknown): DesktopRpcRequest {
	if (!Value.Check(desktopRpcRequestSchema, value)) {
		throw rpcError("invalid_request", {
			message: "Invalid desktop RPC request",
		});
	}
	return value as DesktopRpcRequest;
}

type DesktopHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function resolveHandler(router: DesktopRouter, path: string): DesktopHandler {
	const segments = path.split(".");
	let node: unknown = router;
	for (const segment of segments) {
		if (!isRecord(node) || !Object.hasOwn(node, segment)) {
			throw rpcError("method_not_found", {
				message: `Unknown desktop method "${path}"`,
				data: { path },
			});
		}
		node = node[segment];
	}
	if (typeof node !== "function") {
		throw rpcError("method_not_found", {
			message: `Unknown desktop method "${path}"`,
			data: { path },
		});
	}
	return node as DesktopHandler;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
