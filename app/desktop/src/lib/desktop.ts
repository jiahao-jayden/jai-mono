import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { TaggedError } from "better-result";
import {
	type AsyncRpcClient,
	type DesktopApi,
	type DesktopFailure,
	type DesktopRpcRequest,
	jsonValueSchema,
} from "../../shared/desktop-rpc";

const rpcArgumentsSchema = Type.Array(jsonValueSchema);
class InvalidRpcArguments extends TaggedError("desktop_rpc.invalid_arguments")<{
	readonly message: string;
	readonly path: string;
}> {}

class RemoteRpcError extends TaggedError("desktop_rpc.remote_error")<{
	readonly message: string;
	readonly failure: DesktopFailure;
	readonly remoteTag: string;
}> {}

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
				throw new InvalidRpcArguments({
					message: `Desktop method "${path.join(".")}" only accepts JSON arguments`,
					path: path.join("."),
				});
			}
			const response = await window.desktopRpc.invoke({
				path: path.join("."),
				args: args as DesktopRpcRequest["args"],
			});
			if (response.status === "error") {
				throw new RemoteRpcError({
					message: response.error.message,
					remoteTag: response.error._tag,
					failure: response.error.failure,
				});
			}
			return response.value;
		},
	});
}

export const desktop = createClientProxy([]) as AsyncRpcClient<DesktopApi>;

/** Failure carried by a Desktop RPC rejection; any other thrown value (renderer bug, closed bridge) is `unknown`. */
export function getDesktopRemoteRpcFailure(error: unknown): DesktopFailure {
	return error instanceof RemoteRpcError ? error.failure : { code: "unknown", retryable: false };
}

export function desktopFilePath(file: File): string {
	return window.desktopRpc.getFilePath(file);
}
