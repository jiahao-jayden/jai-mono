/**
 *
 */

export interface TextContent {
	type: "text";
	text: string;
}

export interface ThinkingContent {
	type: "thinking";
	thinking: string;
	/**
	 * 部分模型多轮对话时需要把 thinking signature 原样回传，
	 * 否则 provider 可能拒绝请求。
	 */
	thinkingSignature?: string;
}

export interface ImageContent {
	type: "image";
	image: string;
	mimeType: string;
}

export interface ToolCallContent {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}
