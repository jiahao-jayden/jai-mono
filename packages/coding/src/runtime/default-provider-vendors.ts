export type DefaultProviderAdapter = "anthropic" | "openai-compatible";

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
		adapter: "openai-compatible",
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
		catalogProvider: "moonshotai",
		adapter: "openai-compatible",
		baseURL: "https://api.moonshot.cn/v1",
		modelIdPrefixes: ["kimi-", "moonshot-"],
	},
];

export function findDefaultProviderVendor(modelId: string): DefaultProviderVendor | undefined {
	const normalizedModelId = modelId.trim().toLocaleLowerCase();
	return DEFAULT_PROVIDER_VENDORS.find((vendor) =>
		vendor.modelIdPrefixes.some((prefix) => normalizedModelId.startsWith(prefix)),
	);
}
