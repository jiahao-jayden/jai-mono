export type ParsedModelId = {
	provider: string;
	model: string;
};

/**
 * 解析 "provider/model" 格式的 model ID。
 * 返回 undefined 表示格式不合法（没有 "/"）。
 */
export function parseModelId(modelId: string): ParsedModelId | undefined {
	const slash = modelId.indexOf("/");
	if (slash === -1) return undefined;
	return {
		provider: modelId.slice(0, slash),
		model: modelId.slice(slash + 1),
	};
}
