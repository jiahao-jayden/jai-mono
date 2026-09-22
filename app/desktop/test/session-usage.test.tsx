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
};

const filledUsage: DesktopSessionUsage = {
	inputTokens: 1200,
	outputTokens: 340,
	cacheReadTokens: 100,
	cacheWriteTokens: 20,
	totalTokens: 1660,
	cost: 0.0425,
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

	test("renders a discoverable Usage entry for empty and filled states", () => {
		const emptyMarkup = renderToStaticMarkup(<SessionUsageButton usage={emptyUsage} />);
		expect(emptyMarkup).toContain('aria-label="Session usage"');
		expect(emptyMarkup).toContain(">Usage<");

		const filledMarkup = renderToStaticMarkup(<SessionUsageButton usage={filledUsage} />);
		expect(filledMarkup).toContain("1,660 tok");
		expect(filledMarkup).toContain("$0.0425");
	});
});
