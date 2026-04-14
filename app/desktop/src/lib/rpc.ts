import type { EventSchema, RpcSchema } from "../../electron/rpc/schema";
import type { RpcClient } from "../../electron/rpc/types";

function createRpcClient<T>(): RpcClient<T> {
	return new Proxy({} as RpcClient<T>, {
		get(_target, namespace: string) {
			return new Proxy(
				{},
				{
					get(_t, method: string) {
						return (...args: unknown[]) => window.ipc.invoke(`${namespace}:${method}`, ...args);
					},
				},
			);
		},
	});
}

export const rpc = createRpcClient<RpcSchema>();

export function onEvent<K extends keyof EventSchema>(
	channel: K,
	handler: (...args: EventSchema[K]) => void,
): () => void {
	return window.ipc.on(channel, (_event: unknown, ...args: unknown[]) => handler(...(args as EventSchema[K])));
}
