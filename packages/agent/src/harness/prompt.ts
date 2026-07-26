import type { AgentContext } from "../core/types";

/**
 * 一个 slot 的内容：稳定文本直接给字符串，需要每次求值的给回调。
 * 回调返回 undefined 表示这一段本次不参与渲染。
 */
export type PromptSlotContent<TContext = AgentContext> =
	| string
	| ((context: TContext) => string | undefined | Promise<string | undefined>);

/**
 * system prompt 的一段。name 由调用方自取，只用于替换与诊断；
 * 顺序完全由数组位置决定，harness 不预设 slot 名，也不重排。
 */
export interface PromptSlot<TContext = AgentContext> {
	name: string;
	content: PromptSlotContent<TContext>;
}

/**
 * 按顺序求值 slots，过滤空值，用空行连接。
 * 刻意不用 Promise.all：顺序求值让报错位置稳定，也允许后面的 slot 读到前面求值产生的状态。
 */
export async function renderPrompt<TContext>(
	slots: readonly PromptSlot<TContext>[],
	context: TContext,
): Promise<string> {
	const parts: string[] = [];

	for (const slot of slots) {
		const value = typeof slot.content === "string" ? slot.content : await slot.content(context);

		if (value !== undefined && value !== "") {
			parts.push(value);
		}
	}

	return parts.join("\n\n");
}
