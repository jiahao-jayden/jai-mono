import type { JSONSchema7 } from "@ai-sdk/provider";
import type { z } from "zod";

export type { JSONSchema7 } from "@ai-sdk/provider";

// ── Content blocks ────────────────────────────────────────────

export type TextContent = {
	type: "text";
	text: string;
	synthetic?: boolean;
	source?: string;
};

export type ImageContent = {
	type: "image";
	url?: string;
	data?: string;
	mimeType: string;
};

export type FileContent = {
	type: "file";
	data: string;
	mimeType: string;
	filename?: string;
};

export type ThinkingContent = {
	type: "thinking";
	text: string;
};

export type ToolCall = {
	type: "tool_call";
	toolCallId: string;
	toolName: string;
	input: unknown;
};

// ── Messages ──────────────────────────────────────────────────

export type UserMessage = {
	role: "user";
	content: (TextContent | ImageContent | FileContent)[];
	timestamp: number;
};

export type AssistantMessage = {
	role: "assistant";
	content: (TextContent | ThinkingContent | ToolCall)[];
	stopReason: "stop" | "length" | "tool_calls" | "error" | "aborted";
	usage: Usage;
	timestamp: number;
};

export type ToolResultMessage = {
	role: "tool_result";
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[];
	isError: boolean;
	timestamp: number;
};

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

// ── Tool ──────────────────────────────────────────────────────
// execute 是 jai-agent 层的职责，这里只定义 schema
// parameters 接受 Zod schema 或 JSON Schema 7（用于 MCP 等场景，schema 在运行时才知道）

export type ToolParameters = z.ZodType | JSONSchema7;

export type ToolDefinition<TParams extends ToolParameters = ToolParameters> = {
	name: string;
	description: string;
	parameters: TParams;
};

// ── Usage ─────────────────────────────────────────────────────

export type Usage = {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
};

// ── StreamEvent ───────────────────────────────────────────────

export type StreamEvent =
	| { type: "message_start" }
	| { type: "message_end"; message: AssistantMessage }
	| { type: "text_delta"; text: string }
	| { type: "reasoning_delta"; text: string }
	| { type: "tool_call"; toolCallId: string; toolName: string; input: unknown }
	| { type: "step_finish"; finishReason: string; usage: Usage }
	| { type: "error"; error: Error };

// ── ModelConfig ───────────────────────────────────────────────

export type AIProvider = "anthropic" | "openai" | "google" | "openai-compatible";

export type ProviderConfig = {
	provider: AIProvider;
	model: string;
	apiKey?: string;
	baseURL?: string;
	name?: string;
};

// ── StreamMessageInput ────────────────────────────────────────

export type StreamMessageInput = {
	model: ModelInfo | string; // ModelInfo or "provider/model" string
	systemPrompt?: string;
	messages: Message[];
	tools?: ToolDefinition[];
	abortSignal?: AbortSignal;
	maxRetries?: number;
	apiKey?: string;
	baseURL?: string;
	sessionId?: string;
	reasoningEffort?: string;
};
// ── 模型能力 ──────────────────────────────────────────────────

export type ModelCapabilities = {
	reasoning: boolean;
	toolCall: boolean;
	structuredOutput: boolean;
	input: {
		text: boolean;
		image: boolean;
		audio: boolean;
		video: boolean;
		pdf: boolean;
	};
	output: {
		text: boolean;
		image: boolean;
	};
};

export type ModelLimit = {
	context: number; // context window (tokens)
	output: number; // max output tokens
};

export type ModelCost = {
	input: number; // $/million tokens
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
};

export type ModelInfo = {
	config: ProviderConfig;
	capabilities: ModelCapabilities;
	limit: ModelLimit;
	cost?: ModelCost;
};

/**
 * Lightweight model info returned by enrichModelInfo().
 * Structurally compatible with coding-agent's ProviderModel.
 */
export type EnrichedModelInfo = {
	id: string;
	capabilities?: ModelCapabilities;
	limit?: ModelLimit;
};

// ── ResolvedModel ────────────────────────────────────────────
// Enriched model info with registry context.
// This is what ProviderTransform functions operate on.

export type ResolvedModel = ModelInfo & {
	/** Full model ID: "provider/model" */
	id: string;
	/** Provider ID from registry (e.g., "anthropic", "openai", "alibaba-cn") */
	providerId: string;
	/** npm package for AI SDK (e.g., "@ai-sdk/anthropic") */
	npm: string;
	/** Model ID as used by the provider API (e.g., "claude-sonnet-4-20250514") */
	apiModelId: string;
	/** Model family (e.g., "claude-sonnet") */
	family?: string;
	/** Release date (e.g., "2025-05-14") */
	releaseDate?: string;
	/** Whether interleaved tool calls are supported, with optional field name */
	interleaved?: boolean | { field?: string };
};
