import type { JsonObject } from "../core/json";

/**
 * What a tool call does, as declared by whoever owns the tool. The permission layer reads this to
 * decide whether a call needs approval, so it belongs here rather than in the Extension contract —
 * Extensions are one producer of these declarations, not the concept's owner.
 */
export interface CodingToolPermission {
	readonly sideEffect: "read" | "write" | "destructive";
	readonly dataSensitivity?: "normal" | "sensitive" | "secret";
	readonly reason: string;
}

/** The call being authorized, as handed to a permission resolver. */
export interface CodingExtensionToolCall<TArguments = JsonObject> {
	readonly toolCallId: string;
	readonly args: TArguments;
	readonly signal?: AbortSignal;
}
