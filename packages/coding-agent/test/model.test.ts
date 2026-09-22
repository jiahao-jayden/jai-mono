import { describe, expect, test } from "bun:test";
import { resolveSdkModel } from "../src/sdk/model";

describe("resolveSdkModel", () => {
	test("uses Host-resolved model limits instead of fallback limits", () => {
		const resolved = resolveSdkModel(
			"openai-compatible/deepseek-v4-1-flash",
			{ authentication: "none", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
			undefined,
			{ contextWindow: 1_000_000, maxTokens: 384_000 },
		);

		expect(resolved.model).toMatchObject({
			id: "deepseek-v4-1-flash",
			contextWindow: 1_000_000,
			maxTokens: 384_000,
		});
	});
});
