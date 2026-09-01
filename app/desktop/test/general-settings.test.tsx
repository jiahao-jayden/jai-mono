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
					maxIterations=""
					reasoningEffort=""
					onMaxIterationsChange={() => {}}
					onReasoningEffortChange={() => {}}
				/>
			</LocaleProvider>
		</IntlProvider>,
	);
}

describe("GeneralSettings", () => {
	test("只保留界面语言，Agent 回复语言由它派生", () => {
		const english = renderGeneralSettings("en");
		const chinese = renderGeneralSettings("zh-CN");

		expect(english).toContain("Interface language");
		expect(english).not.toContain("Response language");
		expect(english).toContain("English");
		expect(chinese).toContain("界面语言");
		expect(chinese).not.toContain("回复语言");
		expect(chinese).toContain("简体中文");
	});
});
