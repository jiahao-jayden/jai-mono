import { CodedError } from "@jai/common";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
	type AsyncRpcClient,
	type DesktopApi,
	type DesktopRpcRequest,
	jsonValueSchema,
} from "../../shared/desktop-rpc";

const rpcArgumentsSchema = Type.Array(jsonValueSchema);

function createClientProxy(path: readonly string[]): unknown {
	const callable = () => {};
	return new Proxy(callable, {
		get(_target, property) {
			if (property === "then") return undefined;
			if (typeof property !== "string") return undefined;
			return createClientProxy([...path, property]);
		},
		async apply(_target, _thisArg, args: unknown[]) {
			if (!Value.Check(rpcArgumentsSchema, args)) {
				throw new CodedError({
					code: "desktop_rpc.invalid_arguments",
					message: `Desktop method "${path.join(".")}" only accepts JSON arguments`,
					data: { path: path.join(".") },
				});
			}
			const response = await window.desktopRpc.invoke({
				path: path.join("."),
				args: args as DesktopRpcRequest["args"],
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

export const desktop = createClientProxy([]) as AsyncRpcClient<DesktopApi>;
