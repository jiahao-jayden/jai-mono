import type { IpcMainInvokeEvent } from "electron";

/**
 * Transforms RpcSchema methods into server handler signatures by
 * prepending `event: IpcMainInvokeEvent` to each method's parameters.
 */
export type RpcHandlers<T> = {
	[NS in keyof T]: {
		[M in keyof T[NS]]: T[NS][M] extends (...args: infer A) => infer R
			? (event: IpcMainInvokeEvent, ...args: A) => R | Promise<R>
			: never;
	};
};

/**
 * Transforms RpcSchema methods into async client signatures where
 * every return type is wrapped in `Promise<>`.
 */
export type RpcClient<T> = {
	[NS in keyof T]: {
		[M in keyof T[NS]]: T[NS][M] extends (...args: infer A) => infer R ? (...args: A) => Promise<R> : never;
	};
};
