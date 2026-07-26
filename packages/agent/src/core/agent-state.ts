import type { AgentMessage } from "./types";

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

/** 校验后深拷贝，防止调用方通过引用绕过状态更新与持久化。 */
export function cloneJson<T extends JsonValue>(value: T): T {
	assertJsonValue(value, new Set());
	return structuredClone(value);
}

/**
 * structuredClone 能复制 Map / Date，但它们过一遍 JSON 就变形，
 * 因此在写入边界就拒绝，而不是等落盘后才发现状态丢失。
 */
function assertJsonValue(value: unknown, ancestors: Set<object>): void {
	if (value === null || typeof value === "string" || typeof value === "boolean") return;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError("appState must not contain NaN or Infinity");
		return;
	}
	if (typeof value !== "object") throw new TypeError(`appState must be JSON-serializable, got ${typeof value}`);
	if (ancestors.has(value)) throw new TypeError("appState must not contain cycles");

	const prototype = Object.getPrototypeOf(value);
	if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
		throw new TypeError("appState must contain only plain objects and arrays");
	}

	ancestors.add(value);
	for (const item of Array.isArray(value) ? value : Object.values(value)) {
		assertJsonValue(item, ancestors);
	}
	ancestors.delete(value);
}

/** Agent 当前可观察状态：durable 的对话与业务状态，加上仅运行期有意义的字段。 */
export interface AgentState<TAppState extends JsonObject = JsonObject> {
	readonly systemPrompt: string;
	readonly messages: readonly AgentMessage[];
	readonly appState: TAppState;

	readonly isRunning: boolean;
	readonly streamingMessage?: AgentMessage;
	readonly pendingToolCallIds: ReadonlySet<string>;
	readonly errorMessage?: string;
}

/** Agent 内部持有的可变版本，只由 reducer 与显式的 appState API 修改。 */
export interface MutableAgentState<TAppState extends JsonObject = JsonObject> {
	systemPrompt: string;
	messages: AgentMessage[];
	appState: TAppState;

	isRunning: boolean;
	streamingMessage?: AgentMessage;
	pendingToolCallIds: Set<string>;
	errorMessage?: string;
}

export function freezeState<TAppState extends JsonObject>(state: MutableAgentState<TAppState>): AgentState<TAppState> {
	return {
		systemPrompt: state.systemPrompt,
		messages: [...state.messages],
		appState: cloneJson(state.appState),
		isRunning: state.isRunning,
		streamingMessage: state.streamingMessage,
		pendingToolCallIds: new Set(state.pendingToolCallIds),
		errorMessage: state.errorMessage,
	};
}
