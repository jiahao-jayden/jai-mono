import { ipcMain } from "electron";
import type { RpcSchema } from "./schema";
import type { RpcHandlers } from "./types";

export function registerRpcHandlers(handlers: RpcHandlers<RpcSchema>): void {
	for (const [ns, methods] of Object.entries(handlers)) {
		for (const [method, handler] of Object.entries(methods as Record<string, (...args: unknown[]) => unknown>)) {
			ipcMain.handle(`${ns}:${method}`, handler);
		}
	}
}
