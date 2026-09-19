import { describe, expect, test } from "bun:test";
import { defaultIcons, resolveModelBrandIcon, resolveProviderBrandIcon } from "../src/lib/icon-context";

describe("provider and model brand icons", () => {
	test("keeps Volcengine and Doubao as distinct brands", () => {
		const volcengineIcon = resolveProviderBrandIcon("volcengine");
		const doubaoIcon = resolveModelBrandIcon("doubao-seed-2-0-pro-260215");

		expect(volcengineIcon).not.toBe(defaultIcons.sparkles);
		expect(doubaoIcon).not.toBe(defaultIcons.sparkles);
		expect(doubaoIcon).not.toBe(volcengineIcon);
	});

	test("does not alias first-party model families to their host providers", () => {
		expect(resolveModelBrandIcon("qwen-plus")).not.toBe(resolveProviderBrandIcon("alibaba-cn"));
		expect(resolveModelBrandIcon("glm-5.3")).not.toBe(resolveProviderBrandIcon("zhipuai"));
		expect(resolveModelBrandIcon("gemini-3-flash")).not.toBe(resolveProviderBrandIcon("google"));
	});

	test("reads the model family from a gateway slug", () => {
		expect(resolveModelBrandIcon("anthropic/claude-opus-5")).toBe(resolveModelBrandIcon("claude-opus-5"));
	});

	test("maps curated provider ids to brand icons", () => {
		for (const providerId of [
			"google",
			"alibaba-cn",
			"zhipuai",
			"tencent-tokenhub",
			"siliconflow-cn",
			"xai",
			"mistral",
			"groq",
			"vercel",
			"cloudflare-workers-ai",
		]) {
			expect(resolveProviderBrandIcon(providerId)).not.toBe(defaultIcons.sparkles);
		}
	});
});
