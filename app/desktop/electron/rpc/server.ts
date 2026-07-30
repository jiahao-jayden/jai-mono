import { defineCodedError, toErrorEnvelope } from "@jai/common";
import { type IpcMainInvokeEvent, ipcMain } from "electron";
import { DESKTOP_RPC_CHANNEL, type DesktopRpcRequest, type DesktopRpcResponse } from "./protocol";
import { desktopRouter } from "./router";

const rpcError = defineCodedError("desktop_rpc", ["invalid_request", "method_not_found"] as const);

export function registerDesktopRpc(): void {
	ipcMain.handle(DESKTOP_RPC_CHANNEL, async (event, request: unknown): Promise<DesktopRpcResponse> => {
		try {
			const parsed = parseRequest(request);
			const handler = resolveHandler(parsed.path);
			const value = await handler(event, ...parsed.args);
			return { ok: true, value };
		} catch (error) {
			return { ok: false, error: toErrorEnvelope(error) };
		}
	});
}

function parseRequest(value: unknown): DesktopRpcRequest {
	if (
		typeof value !== "object" ||
		value === null ||
		!("path" in value) ||
		typeof value.path !== "string" ||
		!("args" in value) ||
		!Array.isArray(value.args)
	) {
		throw rpcError("invalid_request", {
			message: "Invalid desktop RPC request",
		});
	}
	return { path: value.path, args: value.args };
}

type DesktopHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

function resolveHandler(path: string): DesktopHandler {
	const segments = path.split(".");
	let node: unknown = desktopRouter;
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
