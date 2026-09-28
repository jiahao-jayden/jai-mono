import { describe, expect, test } from "bun:test";
import { IntlProvider } from "react-intl";
import { renderToStaticMarkup as renderToStaticMarkupBase } from "react-dom/server";
import type { ReactNode } from "react";
import type { DesktopSessionContext, DesktopSessionUsage } from "../shared/desktop-rpc";
import enMessages from "../src/i18n/compiled/en.json";
import { IconProvider } from "../src/lib/icon-context";
import {
	formatSessionTokens,
	isEmptySessionUsage,
	resolveContextBreakdown,
	resolveContextRatio,
	SessionUsageButton,
} from "../src/components/shell/chat/session-usage";

function renderToStaticMarkup(node: ReactNode): string {
	return renderToStaticMarkupBase(
		<IntlProvider locale="en" messages={enMessages}>
			<IconProvider>{node}</IconProvider>
		</IntlProvider>,
	);
}

const emptyUsage: DesktopSessionUsage = {
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
	totalTokens: 0,
	contextTokens: 0,
};

const filledUsage: DesktopSessionUsage = {
	inputTokens: 1200,
	outputTokens: 340,
	cacheReadTokens: 100,
	cacheWriteTokens: 20,
	totalTokens: 1660,
	contextTokens: 32_000,
};

const context: DesktopSessionContext = {
	usedTokens: 50_000,
	contextWindow: 200_000,
	compactAtTokens: 150_000,
	categories: {
		systemPrompt: 100,
		toolDefinitions: 0,
		userMessages: 50,
		assistantText: 50,
		thinking: 200,
		toolInputs: 0,
	},
	toolOutputs: [
		{ toolName: "Read", tokens: 450 },
		{ toolName: "Grep", tokens: 150 },
	],
};

describe("SessionUsageButton", () => {
	test("treats all-zero usage as empty", () => {
		expect(isEmptySessionUsage(emptyUsage)).toBe(true);
		expect(isEmptySessionUsage(filledUsage)).toBe(false);
		expect(formatSessionTokens(1660)).toBe("1,660");
	});

	test("scales estimated category shares to the provider-reported total and hides empty categories", () => {
		const rows = resolveContextBreakdown(context);
		expect(rows.map((row) => row.category)).toEqual([
			"toolOutputs",
			"thinking",
			"systemPrompt",
			"userMessages",
			"assistantText",
		]);
		expect(rows[0]).toEqual({
			category: "toolOutputs",
			share: 0.6,
			tokens: 30_000,
			tools: [
				{ toolName: "Read", share: 0.45, tokens: 22_500 },
				{ toolName: "Grep", share: 0.15, tokens: 7_500 },
			],
		});
		expect(rows[1]).toMatchObject({ category: "thinking", share: 0.2, tokens: 10_000, tools: [] });
		expect(rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1);
		expect(
			resolveContextBreakdown({
				...context,
				categories: { ...context.categories, systemPrompt: 0, userMessages: 0, assistantText: 0, thinking: 0 },
				toolOutputs: [],
			}),
		).toEqual([]);
	});

	test("fills the ring with the measured request over its window, falling back to usage and the model window", () => {
		expect(resolveContextRatio(32_000, 128_000)).toBe(0.25);
		expect(resolveContextRatio(200_000, 128_000)).toBe(1);
		expect(resolveContextRatio(32_000, undefined)).toBe(0);

		const emptyMarkup = renderToStaticMarkup(<SessionUsageButton usage={emptyUsage} />);
		expect(emptyMarkup).toContain('aria-label="Context window"');

		const fallbackMarkup = renderToStaticMarkup(<SessionUsageButton usage={filledUsage} contextWindow={128_000} />);
		expect(fallbackMarkup).toContain("Context 32K / 128K · 25%");

		const measuredMarkup = renderToStaticMarkup(
			<SessionUsageButton usage={filledUsage} context={context} contextWindow={128_000} />,
		);
		expect(measuredMarkup).toContain("Context 50K / 200K · 25%");
		expect(measuredMarkup).not.toContain("Cost");
	});
});
