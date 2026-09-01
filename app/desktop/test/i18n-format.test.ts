import { describe, expect, test } from "bun:test";
import { createIntl } from "react-intl";
import enMessages from "../src/i18n/compiled/en.json";
import zhCnMessages from "../src/i18n/compiled/zh-CN.json";

const en = createIntl({ locale: "en", messages: enMessages });
const zhCn = createIntl({ locale: "zh-CN", messages: zhCnMessages });

describe("Desktop i18n formatting", () => {
	test("formats dates, relative time, and units with the active locale", () => {
		const options = { year: "numeric" as const, month: "long" as const, day: "numeric" as const, timeZone: "UTC" };
		const unitOptions = {
			style: "unit" as const,
			unit: "megabyte" as const,
			unitDisplay: "long" as const,
			maximumFractionDigits: 1,
		};

		expect(en.formatDate(Date.UTC(2025, 0, 2), options)).toBe("January 2, 2025");
		expect(zhCn.formatDate(Date.UTC(2025, 0, 2), options)).toBe("2025年1月2日");
		expect(en.formatRelativeTime(-1, "day", { numeric: "auto" })).toBe("yesterday");
		expect(zhCn.formatRelativeTime(-1, "day", { numeric: "auto" })).toBe("昨天");
		expect(en.formatNumber(1234.5, unitOptions)).toBe("1,234.5 megabytes");
		expect(zhCn.formatNumber(1234.5, unitOptions)).toBe("1,234.5兆字节");
	});

	test("formats singular and plural product counts through ICU messages", () => {
		expect(en.formatMessage({ id: "desktop.projects.chatCount" }, { count: 1 })).toBe("1 chat");
		expect(en.formatMessage({ id: "desktop.projects.chatCount" }, { count: 2 })).toBe("2 chats");
		expect(zhCn.formatMessage({ id: "desktop.projects.chatCount" }, { count: 1 })).toBe("1 个对话");
		expect(zhCn.formatMessage({ id: "desktop.projects.chatCount" }, { count: 2 })).toBe("2 个对话");
	});
});
