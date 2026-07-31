import { type Static, Type } from "@sinclair/typebox";

export const DESKTOP_RPC_CHANNEL = "desktop:rpc";

export const jsonValueSchema = Type.Recursive((This) =>
	Type.Union([
		Type.Null(),
		Type.Boolean(),
		Type.Number(),
		Type.String(),
		Type.Array(This),
		Type.Record(Type.String(), This),
	]),
);

const errorEnvelopeSchema = Type.Object(
	{
		code: Type.String({ minLength: 1 }),
		message: Type.String(),
		data: Type.Optional(jsonValueSchema),
	},
	{ additionalProperties: false },
);

export const desktopRpcRequestSchema = Type.Object(
	{
		path: Type.String({ minLength: 1 }),
		args: Type.Array(jsonValueSchema),
	},
	{ additionalProperties: false },
);

export type DesktopTheme = "light" | "dark" | "system";

export interface DesktopApi {
	readonly window: {
		close(): void;
		minimize(): void;
		fullscreen(): void;
	};
	readonly theme: {
		get(): DesktopTheme;
		set(theme: DesktopTheme): void;
	};
}

export type AsyncRpcClient<T> = {
	[K in keyof T]: T[K] extends (...args: infer TArgs) => infer TResult
		? (...args: TArgs) => Promise<Awaited<TResult>>
		: AsyncRpcClient<T[K]>;
};

export type DesktopRpcRequest = Static<typeof desktopRpcRequestSchema>;
export type DesktopRpcResponse =
	| { readonly ok: true; readonly value?: Static<typeof jsonValueSchema> }
	| { readonly ok: false; readonly error: Static<typeof errorEnvelopeSchema> };

export interface DesktopBridge {
	readonly platform: {
		readonly isMac: boolean;
	};
	invoke(request: DesktopRpcRequest): Promise<DesktopRpcResponse>;
}
