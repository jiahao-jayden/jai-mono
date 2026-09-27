import { type Static, Type } from "@sinclair/typebox";

export const RUNTIME_FAILURE_DETAIL_LIMIT = 2000;

/**
 * Wire DTO for the latest failed Operation; ACP clients validate it with this schema. Kept free of
 * `@jai/ai` imports because the `acp-client` bundle re-exports it.
 */
export const runtimeFailureSchema = Type.Object(
	{
		code: Type.Union([
			Type.Literal("provider.auth_failed"),
			Type.Literal("provider.rate_limited"),
			Type.Literal("provider.context_overflow"),
			Type.Literal("provider.invalid_request"),
			Type.Literal("provider.unavailable"),
			Type.Literal("provider.network"),
			Type.Literal("runtime.operation_failed"),
			Type.Literal("runtime.interrupted"),
			Type.Literal("configuration.invalid"),
			Type.Literal("unknown"),
		]),
		retryable: Type.Boolean(),
		action: Type.Optional(Type.Union([Type.Literal("retry"), Type.Literal("open_provider_settings")])),
		detail: Type.Optional(Type.String({ maxLength: RUNTIME_FAILURE_DETAIL_LIMIT })),
	},
	{ additionalProperties: false },
);

export type RuntimeFailure = Static<typeof runtimeFailureSchema>;
