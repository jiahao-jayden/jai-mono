import { describe, expect, test } from "bun:test";
import { matchesSettingsCategory } from "../src/components/shell/settings/settings-navigation";

describe("settings search", () => {
	test("用关键词也能找到分类", () => {
		expect(matchesSettingsCategory("providers", "Providers", "model")).toBe(true);
		expect(matchesSettingsCategory("providers", "服务商", "模型")).toBe(true);
		expect(matchesSettingsCategory("logs", "日志", "debug")).toBe(true);
		expect(matchesSettingsCategory("general", "General", "model")).toBe(false);
		expect(matchesSettingsCategory("general", "常规", "")).toBe(true);
	});
});
