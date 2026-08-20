import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { TaggedError } from "better-result";
import {
	type AsyncRpcClient,
	type DesktopAgentCreationFailureReason,
	type DesktopApi,
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
	readonly remoteReason?: DesktopAgentCreationFailureReason;
	readonly remoteTag: string;
}> {}

export interface DesktopRemoteRpcFailure {
	readonly reason?: DesktopAgentCreationFailureReason;
	readonly tag: string;
}

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
					...(response.error.reason ? { remoteReason: response.error.reason } : {}),
				});
			}
			return response.value;
		},
	});
}

export const desktop = createClientProxy([]) as AsyncRpcClient<DesktopApi>;

export function getDesktopRemoteRpcFailure(error: unknown): DesktopRemoteRpcFailure | undefined {
	if (!(error instanceof RemoteRpcError)) return undefined;
	return {
		tag: error.remoteTag,
		...(error.remoteReason ? { reason: error.remoteReason } : {}),
	};
}

export function desktopFilePath(file: File): string {
	return window.desktopRpc.getFilePath(file);
}
