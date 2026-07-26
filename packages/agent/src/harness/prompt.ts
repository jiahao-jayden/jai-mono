/**
 * 把已经准备好的 Prompt 片段按顺序组装成一个字符串。
 *
 * 内容从哪里来、何时刷新、放什么顺序由调用方决定；这里不引入变量语法、
 * 命名片段或异步求值。`undefined` 和空字符串用于省略可选片段。
 */
export function promptTemplate(...parts: readonly (string | undefined)[]): string {
	return parts.filter((part) => part !== undefined && part !== "").join("\n\n");
}
