import { CodedError } from "@jai/common";
import type { DesktopRouter } from "../../electron/rpc/router";

type DesktopClient<T> = {
	[K in keyof T]: T[K] extends (event: infer _TEvent, ...args: infer TArgs) => infer TResult
		? (...args: TArgs) => Promise<Awaited<TResult>>
		: DesktopClient<T[K]>;
};

function createClientProxy(path: readonly string[]): unknown {
	const callable = () => {};
	return new Proxy(callable, {
		get(_target, property) {
			if (property === "then") return undefined;
			if (typeof property !== "string") return undefined;
			return createClientProxy([...path, property]);
		},
		async apply(_target, _thisArg, args: unknown[]) {
			const response = await window.desktopRpc.invoke({
				path: path.join("."),
				args,
			});
			if (!response.ok) {
				throw new CodedError({
					code: response.error.code,
					message: response.error.message,
					data: response.error.data,
				});
			}
			return response.value;
		},
	});
}

export const desktop = createClientProxy([]) as DesktopClient<DesktopRouter>;
export const desktopPlatform = window.desktopRpc.platform;
