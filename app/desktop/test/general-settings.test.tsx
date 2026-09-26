import { describe, expect, test } from "bun:test";
import { IntlProvider } from "react-intl";
import { renderToStaticMarkup as renderToStaticMarkupBase } from "react-dom/server";
import type { DesktopProviderProfile } from "../shared/desktop-rpc";
import { GeneralSettings } from "../src/components/shell/settings/general-settings";
import zhMessages from "../src/i18n/compiled/zh-CN.json";
import { LocaleProvider } from "../src/i18n/locale";

const profile: DesktopProviderProfile = {
	id: "gateway",
	name: "Gateway",
	adapter: "openai-compatible",
	baseURL: "https://gateway.example/v1",
	authentication: "api-key",
	credentialConfigured: true,
	models: [
		{
			id: "gateway/aux-mini",
			name: "Aux Mini",
			remoteModelId: "aux-mini",
			source: "unverified",
			enabled: true,
			verified: false,
			capabilities: { reasoningLevels: [], supportsFastMode: false },
		},
	],
};

function renderGeneralSettings(
	locale: "en" | "zh-CN",
	auxiliaryModelRef?: string,
	messages: Record<string, string> = {},
): string {
	return renderToStaticMarkupBase(
		<IntlProvider locale={locale} messages={messages}>
			<LocaleProvider initialSnapshot={{ preference: locale, locale }}>
				<GeneralSettings
					maxIterations=""
					onMaxIterationsChange={() => {}}
					profiles={[profile]}
					auxiliaryModelRef={auxiliaryModelRef}
					onAuxiliaryModelChange={() => {}}
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

	test("辅助模型默认跟随当前会话模型，也能显示已选模型", () => {
		const following = renderGeneralSettings("en");
		const chosen = renderGeneralSettings("en", "gateway/aux-mini");
		const chinese = renderGeneralSettings("zh-CN", undefined, zhMessages);

		expect(following).toContain('aria-label="Auxiliary model"');
		expect(following).toContain("Follow the session model");
		expect(chosen).toContain("Gateway · Aux Mini");
		expect(chosen).not.toContain("(unavailable)");
		expect(chinese).toContain("跟随当前会话模型");
	});

	test("已选但不可用的辅助模型明确标出，不静默改成跟随会话", () => {
		const markup = renderGeneralSettings("en", "gone/old-model");

		expect(markup).toContain("gone/old-model (unavailable)");
		expect(markup).toContain('role="alert"');
	});
});
