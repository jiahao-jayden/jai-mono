import type { ProviderSettings } from "@jayden/jai-gateway";

export type ProviderFormat = ProviderSettings["api_format"];

export interface BuiltinProvider {
	id: string;
	name: string;
	description: string;
	api_base: string;
	api_format: ProviderFormat;
	apiKeyUrl?: string;
}

export const BUILTIN_PROVIDERS: BuiltinProvider[] = [
	{
		id: "openai",
		name: "OpenAI",
		description: "GPT-5.2, o3, GPT-4o and more",
		api_base: "https://api.openai.com/v1",
		api_format: "openai",
		apiKeyUrl: "https://platform.openai.com/api-keys",
	},
	{
		id: "anthropic",
		name: "Anthropic",
		description: "Claude 4, Claude Sonnet, Claude Haiku",
		api_base: "https://api.anthropic.com",
		api_format: "anthropic",
		apiKeyUrl: "https://console.anthropic.com/settings/keys",
	},
	{
		id: "gemini",
		name: "Google Gemini",
		description: "Gemini 2.5 Pro, Flash and more",
		api_base: "https://generativelanguage.googleapis.com/v1beta",
		api_format: "google",
		apiKeyUrl: "https://aistudio.google.com/apikey",
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		description: "Unified gateway to 200+ models",
		api_base: "https://openrouter.ai/api/v1",
		api_format: "openai-compatible",
		apiKeyUrl: "https://openrouter.ai/keys",
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		description: "DeepSeek V3, R1 reasoning models",
		api_base: "https://api.deepseek.com/v1",
		api_format: "openai-compatible",
		apiKeyUrl: "https://platform.deepseek.com/api_keys",
	},
];

export const BUILTIN_IDS = new Set(BUILTIN_PROVIDERS.map((p) => p.id));

export function getBuiltinProvider(id: string): BuiltinProvider | undefined {
	return BUILTIN_PROVIDERS.find((p) => p.id === id);
}

export const API_FORMAT_OPTIONS: { value: ProviderFormat; label: string }[] = [
	{ value: "openai-compatible", label: "OpenAI Compatible" },
	{ value: "openai", label: "OpenAI" },
	{ value: "anthropic", label: "Anthropic" },
	{ value: "google", label: "Google" },
];
