import type { ErrorEnvelope } from "@jai/common";

export const DESKTOP_RPC_CHANNEL = "desktop:rpc";

export interface DesktopRpcRequest {
	readonly path: string;
	readonly args: readonly unknown[];
}

export type DesktopRpcResponse =
	| { readonly ok: true; readonly value: unknown }
	| { readonly ok: false; readonly error: ErrorEnvelope };

export interface DesktopBridge {
	readonly platform: {
		readonly isMac: boolean;
	};
	invoke(request: DesktopRpcRequest): Promise<DesktopRpcResponse>;
}
