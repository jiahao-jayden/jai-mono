import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DesktopProfileTokenStats } from "../shared/desktop-rpc";
import { ProfileTokenDashboard } from "../src/components/shell/settings/profile-settings";
import { IconProvider } from "../src/lib/icon-context";

function render(stats: DesktopProfileTokenStats) {
	return renderToStaticMarkup(
		<IntlProvider locale="en" messages={{}}>
			<QueryClientProvider client={new QueryClient()}>
				<IconProvider>
					<ProfileTokenDashboard stats={stats} />
				</IconProvider>
			</QueryClientProvider>
		</IntlProvider>,
	);
}

const completeStats: DesktopProfileTokenStats = {
	availability: "complete",
	totalTokens: 40,
	peakDayTokens: 30,
	peakDayDate: "2026-09-21",
	days: [
		{ date: "2026-09-20", totalTokens: 10 },
		{ date: "2026-09-21", totalTokens: 30 },
	],
	models: [
		{ provider: "anthropic", modelId: "claude", totalTokens: 30 },
		{ provider: "openai-compatible", modelId: "deepseek", totalTokens: 10 },
	],
	promptCount: 2,
	settledAttemptCount: 2,
	missingUsageAttemptCount: 0,
};

describe("ProfileTokenDashboard", () => {
	test("shows lifetime total, peak day, heatmap unit, and model distribution", () => {
		const markup = render(completeStats);
		expect(markup).toContain("40");
		expect(markup).toContain("2026-09-21");
		expect(markup).toContain("anthropic");
		expect(markup).toContain("claude");
		expect(markup).toContain("tokens");
		expect(markup).toContain('role="img"');
	});

	test("shows empty token degradation while keeping prompts", () => {
		const markup = render({
			availability: "empty",
			totalTokens: 0,
			peakDayTokens: 0,
			peakDayDate: "",
			days: [],
			models: [],
			promptCount: 3,
			settledAttemptCount: 0,
			missingUsageAttemptCount: 0,
		});
		expect(markup).toContain("3");
		expect(markup).toContain("Prompts are recorded");
		expect(markup).toContain("—");
	});

	test("keeps settled totals when some attempts have no usage", () => {
		const markup = render({
			...completeStats,
			availability: "partial",
			missingUsageAttemptCount: 2,
		});
		expect(markup).toContain("40");
		expect(markup).not.toContain("no token usage");
	});
});
