import { AiGenerativeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import Anthropic from "@lobehub/icons/es/Anthropic";
import Baichuan from "@lobehub/icons/es/Baichuan";
import ChatGLM from "@lobehub/icons/es/ChatGLM";
import Claude from "@lobehub/icons/es/Claude";
import Cohere from "@lobehub/icons/es/Cohere";
import Dalle from "@lobehub/icons/es/Dalle";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Doubao from "@lobehub/icons/es/Doubao";
import Flux from "@lobehub/icons/es/Flux";
import Gemini from "@lobehub/icons/es/Gemini";
import Gemma from "@lobehub/icons/es/Gemma";
import Google from "@lobehub/icons/es/Google";
import Grok from "@lobehub/icons/es/Grok";
import Hunyuan from "@lobehub/icons/es/Hunyuan";
import InternLM from "@lobehub/icons/es/InternLM";
import Kimi from "@lobehub/icons/es/Kimi";
import Meta from "@lobehub/icons/es/Meta";
import Microsoft from "@lobehub/icons/es/Microsoft";
import Minimax from "@lobehub/icons/es/Minimax";
import Mistral from "@lobehub/icons/es/Mistral";
import Moonshot from "@lobehub/icons/es/Moonshot";
import Nvidia from "@lobehub/icons/es/Nvidia";
import OpenAI from "@lobehub/icons/es/OpenAI";
import Qwen from "@lobehub/icons/es/Qwen";
import Spark from "@lobehub/icons/es/Spark";
import Stepfun from "@lobehub/icons/es/Stepfun";
import Wenxin from "@lobehub/icons/es/Wenxin";
import Yi from "@lobehub/icons/es/Yi";
import type { ComponentType } from "react";

export type IconComponent = ComponentType<{ className?: string; size?: number }>;

export const MODEL_BRAND_RULES: [patterns: string[], icon: IconComponent, brand: string][] = [
	[["dall-e", "dalle"], Dalle, "DALL-E"],
	[["gpt-", "gpt4", "gpt3", "gpt5", "chatgpt", "o1-", "o3-", "o4-", "o1pro"], OpenAI, "OpenAI"],
	[["claude"], Claude, "Claude"],
	[["gemma"], Gemma, "Gemma"],
	[["gemini", "palm"], Gemini, "Gemini"],
	[["llama", "llava"], Meta, "Meta"],
	[["deepseek"], DeepSeek, "DeepSeek"],
	[["mistral", "mixtral", "codestral", "pixtral", "ministral"], Mistral, "Mistral"],
	[["qwen", "qwq"], Qwen, "Qwen"],
	[["doubao", "skylark"], Doubao, "Doubao"],
	[["baichuan"], Baichuan, "Baichuan"],
	[["glm", "chatglm"], ChatGLM, "ChatGLM"],
	[["minimax", "abab"], Minimax, "MiniMax"],
	[["kimi"], Kimi, "Kimi"],
	[["moonshot"], Moonshot, "Moonshot"],
	[["ernie", "wenxin"], Wenxin, "Wenxin"],
	[["spark"], Spark, "Spark"],
	[["grok"], Grok, "Grok"],
	[["internlm"], InternLM, "InternLM"],
	[["step-"], Stepfun, "StepFun"],
	[["hunyuan"], Hunyuan, "Hunyuan"],
	[["yi-"], Yi, "Yi"],
	[["command-r", "command-a", "c4ai"], Cohere, "Cohere"],
	[["phi-", "phi3", "phi4"], Microsoft, "Microsoft"],
	[["nemotron"], Nvidia, "Nvidia"],
	[["flux"], Flux, "Flux"],
];

export const PROVIDER_BRAND_RULES: [patterns: string[], icon: IconComponent, brand: string][] = [
	[["openai"], OpenAI, "OpenAI"],
	[["anthropic"], Anthropic, "Anthropic"],
	[["claude"], Claude, "Claude"],
	[["google"], Google, "Google"],
	[["gemini"], Gemini, "Gemini"],
	[["meta"], Meta, "Meta"],
	[["deepseek"], DeepSeek, "DeepSeek"],
	[["mistral"], Mistral, "Mistral"],
	[["qwen", "alibaba", "dashscope"], Qwen, "Qwen"],
	[["doubao", "bytedance", "volcengine"], Doubao, "Doubao"],
	[["baichuan"], Baichuan, "Baichuan"],
	[["zhipu", "chatglm"], ChatGLM, "ChatGLM"],
	[["minimax"], Minimax, "MiniMax"],
	[["moonshot"], Moonshot, "Moonshot"],
	[["kimi"], Kimi, "Kimi"],
	[["baidu", "wenxin", "ernie"], Wenxin, "Wenxin"],
	[["iflytek", "spark"], Spark, "Spark"],
	[["xai", "grok"], Grok, "Grok"],
	[["stepfun", "step"], Stepfun, "StepFun"],
	[["hunyuan", "tencent"], Hunyuan, "Hunyuan"],
	[["yi", "lingyiwanwu", "01ai"], Yi, "Yi"],
	[["cohere"], Cohere, "Cohere"],
	[["microsoft", "azure"], Microsoft, "Microsoft"],
	[["nvidia"], Nvidia, "Nvidia"],
	[["openrouter"], OpenAI, "OpenRouter"],
];

export function matchBrand(
	input: string,
	rules: [patterns: string[], icon: IconComponent, brand: string][],
): { icon: IconComponent; brand: string } | null {
	const lower = input.toLowerCase();
	for (const [patterns, icon, brand] of rules) {
		if (patterns.some((p) => lower.includes(p))) return { icon, brand };
	}
	return null;
}

export function resolveModelIcon(modelId: string): { icon: IconComponent; brand: string } | null {
	const modelName = modelId.includes("/") ? modelId.split("/").pop()! : modelId;
	return matchBrand(modelName, MODEL_BRAND_RULES);
}

export function resolveProviderIcon(providerId: string): { icon: IconComponent; brand: string } | null {
	return matchBrand(providerId, PROVIDER_BRAND_RULES);
}

export function BrandAvatar({ icon: Icon, size = 20 }: { icon: IconComponent | null; size?: number }) {
	if (Icon) return <Icon className="shrink-0" size={size} />;
	return (
		<HugeiconsIcon
			icon={AiGenerativeIcon}
			size={size}
			strokeWidth={1.5}
			className="shrink-0 text-muted-foreground/50"
		/>
	);
}
