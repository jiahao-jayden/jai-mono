export type DefaultProviderAdapter = "anthropic" | "openai-compatible" | "openai-responses";

/**
 * First-party model vendors. Besides powering Desktop presets, this registry
 * gives a stable Models.dev authority to well-known model families when the
 * same remote ID is also exposed by proxy gateways.
 */
export interface DefaultProviderVendor {
	readonly id: string;
	readonly name: string;
	readonly catalogProvider: string;
	readonly adapter: DefaultProviderAdapter;
	readonly baseURL?: string;
	readonly modelIdPrefixes: readonly string[];
}

export const DEFAULT_PROVIDER_VENDORS: readonly DefaultProviderVendor[] = [
	{
		id: "anthropic",
		name: "Anthropic",
		catalogProvider: "anthropic",
		adapter: "anthropic",
		modelIdPrefixes: ["claude-"],
	},
	{
		id: "openai",
		name: "OpenAI",
		catalogProvider: "openai",
		adapter: "openai-responses",
		modelIdPrefixes: ["gpt-", "chatgpt-", "o1", "o3", "o4", "o5", "codex-"],
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		catalogProvider: "deepseek",
		adapter: "openai-compatible",
		baseURL: "https://api.deepseek.com/v1",
		modelIdPrefixes: ["deepseek-"],
	},
	{
		id: "minimax",
		name: "MiniMax",
		catalogProvider: "minimax",
		adapter: "openai-compatible",
		baseURL: "https://api.minimax.io/v1",
		modelIdPrefixes: ["minimax-"],
	},
	{
		id: "moonshot",
		name: "Kimi",
		catalogProvider: "moonshotai-cn",
		adapter: "openai-compatible",
		baseURL: "https://api.moonshot.cn/v1",
		modelIdPrefixes: ["kimi-", "moonshot-"],
	},
	{
		id: "volcengine",
		name: "Volcengine Ark",
		catalogProvider: "volcengine",
		adapter: "openai-compatible",
		baseURL: "https://ark.cn-beijing.volces.com/api/v3",
		modelIdPrefixes: ["doubao-"],
	},
	{
		id: "google",
		name: "Gemini",
		catalogProvider: "google",
		adapter: "openai-compatible",
		baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
		modelIdPrefixes: ["gemini-"],
	},
	{
		id: "alibaba-cn",
		name: "Alibaba Cloud",
		catalogProvider: "alibaba-cn",
		adapter: "openai-compatible",
		baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		modelIdPrefixes: [],
	},
	{
		id: "alibaba",
		name: "Alibaba Cloud International",
		catalogProvider: "alibaba",
		adapter: "openai-compatible",
		baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
		modelIdPrefixes: [],
	},
	{
		id: "zhipuai",
		name: "Zhipu AI",
		catalogProvider: "zhipuai",
		adapter: "openai-compatible",
		baseURL: "https://open.bigmodel.cn/api/paas/v4/",
		modelIdPrefixes: ["glm-"],
	},
	{
		id: "tencent-tokenhub",
		name: "Tencent TokenHub",
		catalogProvider: "tencent-tokenhub",
		adapter: "openai-compatible",
		baseURL: "https://tokenhub.tencentmaas.com/v1",
		modelIdPrefixes: [],
	},
	{
		id: "tencent-tokenhub-intl",
		name: "Tencent TokenHub International",
		catalogProvider: "tencent-tokenhub",
		adapter: "openai-compatible",
		baseURL: "https://tokenhub-intl.tencentmaas.com/v1",
		modelIdPrefixes: [],
	},
	{
		id: "minimax-cn",
		name: "MiniMax (China)",
		catalogProvider: "minimax-cn",
		adapter: "openai-compatible",
		baseURL: "https://api.minimaxi.com/v1",
		modelIdPrefixes: [],
	},
	{
		id: "moonshot-intl",
		name: "Kimi International",
		catalogProvider: "moonshotai",
		adapter: "openai-compatible",
		baseURL: "https://api.moonshot.ai/v1",
		modelIdPrefixes: [],
	},
	{
		id: "siliconflow-cn",
		name: "SiliconFlow",
		catalogProvider: "siliconflow-cn",
		adapter: "openai-compatible",
		baseURL: "https://api.siliconflow.cn/v1",
		modelIdPrefixes: [],
	},
	{
		id: "siliconflow",
		name: "SiliconFlow International",
		catalogProvider: "siliconflow",
		adapter: "openai-compatible",
		baseURL: "https://api.siliconflow.com/v1",
		modelIdPrefixes: [],
	},
	{
		id: "xai",
		name: "xAI",
		catalogProvider: "xai",
		adapter: "openai-responses",
		baseURL: "https://api.x.ai/v1",
		modelIdPrefixes: ["grok-"],
	},
	{
		id: "mistral",
		name: "Mistral",
		catalogProvider: "mistral",
		adapter: "openai-compatible",
		baseURL: "https://api.mistral.ai/v1",
		modelIdPrefixes: ["mistral-", "codestral-", "pixtral-", "ministral-"],
	},
	{
		id: "groq",
		name: "Groq",
		catalogProvider: "groq",
		adapter: "openai-compatible",
		baseURL: "https://api.groq.com/openai/v1",
		modelIdPrefixes: [],
	},
	{
		id: "vercel",
		name: "Vercel AI Gateway",
		catalogProvider: "vercel",
		adapter: "openai-compatible",
		baseURL: "https://ai-gateway.vercel.sh/v1",
		modelIdPrefixes: [],
	},
	{
		id: "cloudflare-workers-ai",
		name: "Cloudflare Workers AI",
		catalogProvider: "cloudflare-workers-ai",
		adapter: "openai-compatible",
		baseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
		modelIdPrefixes: [],
	},
];

export function findDefaultProviderVendor(baseURL: string, modelId: string): DefaultProviderVendor | undefined {
	const normalizedBaseURL = baseURL.replace(/\/+$/, "");
	const configuredVendor = DEFAULT_PROVIDER_VENDORS.find((vendor) =>
		vendor.catalogProvider === "cloudflare-workers-ai"
			? isCloudflareWorkersAiBaseURL(normalizedBaseURL)
			: vendor.baseURL?.replace(/\/+$/, "") === normalizedBaseURL,
	);
	if (configuredVendor) return configuredVendor;
	const normalizedModelId = modelId.trim().toLocaleLowerCase();
	return DEFAULT_PROVIDER_VENDORS.find((vendor) =>
		vendor.modelIdPrefixes.some((prefix) => normalizedModelId.startsWith(prefix)),
	);
}

function isCloudflareWorkersAiBaseURL(baseURL: string): boolean {
	try {
		const url = new URL(baseURL);
		return url.hostname === "api.cloudflare.com" && url.pathname.replace(/\/+$/, "").endsWith("/ai/v1");
	} catch {
		return false;
	}
}
