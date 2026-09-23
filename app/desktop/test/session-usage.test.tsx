import { describe, expect, test } from "bun:test";
import { IntlProvider } from "react-intl";
import { renderToStaticMarkup as renderToStaticMarkupBase } from "react-dom/server";
import type { ReactNode } from "react";
import type { DesktopSessionUsage } from "../shared/desktop-rpc";
import enMessages from "../src/i18n/compiled/en.json";
import { IconProvider } from "../src/lib/icon-context";
import {
	formatSessionCost,
	formatSessionTokens,
	isEmptySessionUsage,
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
	cost: 0,
	contextTokens: 0,
};

const filledUsage: DesktopSessionUsage = {
	inputTokens: 1200,
	outputTokens: 340,
	cacheReadTokens: 100,
	cacheWriteTokens: 20,
	totalTokens: 1660,
	cost: 0.0425,
	contextTokens: 32_000,
};

describe("SessionUsageButton", () => {
	test("treats all-zero usage as empty", () => {
		expect(isEmptySessionUsage(emptyUsage)).toBe(true);
		expect(isEmptySessionUsage(filledUsage)).toBe(false);
	});

	test("formats cost and tokens for the trigger", () => {
		expect(formatSessionCost(0)).toBe("$0");
		expect(formatSessionCost(0.0042)).toBe("$0.0042");
		expect(formatSessionCost(0.0425)).toBe("$0.0425");
		expect(formatSessionCost(1.2)).toBe("$1.20");
		expect(formatSessionTokens(1660)).toBe("1,660");
	});

	test("fills the ring with the latest request size over the model context window", () => {
		expect(resolveContextRatio(32_000, 128_000)).toBe(0.25);
		expect(resolveContextRatio(200_000, 128_000)).toBe(1);
		expect(resolveContextRatio(32_000, undefined)).toBe(0);

		const emptyMarkup = renderToStaticMarkup(<SessionUsageButton usage={emptyUsage} />);
		expect(emptyMarkup).toContain('aria-label="Session usage"');

		const filledMarkup = renderToStaticMarkup(<SessionUsageButton usage={filledUsage} contextWindow={128_000} />);
		expect(filledMarkup).toContain("Context 32K / 128K · 25%");
	});
});
