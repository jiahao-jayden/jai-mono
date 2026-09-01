import { describe, expect, test } from "bun:test";
import { IntlProvider } from "react-intl";
import { renderToStaticMarkup as renderToStaticMarkupBase } from "react-dom/server";
import { GeneralSettings } from "../src/components/shell/settings/general-settings";
import { LocaleProvider } from "../src/i18n/locale";

function renderGeneralSettings(locale: "en" | "zh-CN"): string {
	return renderToStaticMarkupBase(
		<IntlProvider locale={locale} messages={{}}>
			<LocaleProvider initialSnapshot={{ preference: locale, locale }}>
				<GeneralSettings
					language="zh-CN"
					maxIterations=""
					reasoningEffort=""
					onLanguageChange={() => {}}
					onMaxIterationsChange={() => {}}
					onReasoningEffortChange={() => {}}
				/>
			</LocaleProvider>
		</IntlProvider>,
	);
}

describe("GeneralSettings", () => {
	test("界面语言和 Agent 回复语言保持为两个独立字段", () => {
		const english = renderGeneralSettings("en");
		const chinese = renderGeneralSettings("zh-CN");

		expect(english).toContain("Interface language");
		expect(english).toContain("Response language");
		expect(english).toContain("English");
		expect(chinese).toContain("界面语言");
		expect(chinese).toContain("回复语言");
		expect(chinese).toContain("简体中文");
	});
});
