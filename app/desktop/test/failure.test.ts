import { describe, expect, mock, spyOn, test } from "bun:test";
import { createIntl } from "react-intl";
import { toast } from "../src/components/ui/toast";
import enMessages from "../src/i18n/compiled/en.json";
import zhCnMessages from "../src/i18n/compiled/zh-CN.json";
import { notifyFailure, presentFailure } from "../src/lib/failure";
import { type DesktopFailureCode, desktopFailureSchema } from "../shared/desktop-rpc";

const locales = {
	en: createIntl({ locale: "en", messages: enMessages, onError: (error) => expect.unreachable(error.message) }),
	"zh-CN": createIntl({ locale: "zh-CN", messages: zhCnMessages, onError: (error) => expect.unreachable(error.message) }),
};
const codes = desktopFailureSchema.properties.code.anyOf.map((literal) => literal.const) as DesktopFailureCode[];

describe("presentFailure", () => {
	test("has localized copy for every failure code in both locales", () => {
		expect(codes).toHaveLength(18);
		for (const code of codes) {
			const en = presentFailure({ code, retryable: false }, locales.en);
			const zh = presentFailure({ code, retryable: false }, locales["zh-CN"]);
			for (const presented of [en, zh]) {
				expect(presented.title.trim()).not.toBe("");
				expect(presented.description.trim()).not.toBe("");
				expect(presented.actions).toEqual([]);
			}
			expect(zh.title).not.toBe(en.title);
			expect(zh.description).not.toBe(en.description);
			expect(zh.title).toMatch(/[\p{Script=Han}]/u);
		}
	});

	test("labels the suggested action and passes the redacted detail through for copying", () => {
		const presented = presentFailure(
			{ code: "provider.auth_failed", retryable: false, action: "open_provider_settings", detail: "502 Bearer [REDACTED]" },
			locales["zh-CN"],
		);
		expect(presented).toEqual({
			title: "模型认证失败",
			description: "当前模型的服务拒绝了认证，请检查 API key 或重新登录网关。",
			detail: "502 Bearer [REDACTED]",
			actions: [{ action: "open_provider_settings", label: "打开设置" }],
		});
		for (const action of ["retry", "open_provider_settings", "reconnect", "choose_project", "choose_model"] as const) {
			const [en] = presentFailure({ code: "unknown", retryable: true, action }, locales.en).actions;
			const [zh] = presentFailure({ code: "unknown", retryable: true, action }, locales["zh-CN"]).actions;
			expect(en?.label).toBeTruthy();
			expect(zh?.label).toBeTruthy();
			expect(zh?.label).not.toBe(en?.label);
		}
	});
});

describe("notifyFailure", () => {
	test("adds a transient error toast when there is nothing to act on or copy", () => {
		const add = spyOn(toast, "add").mockReturnValue("toast-id");
		notifyFailure({ code: "request.failed", retryable: true }, locales.en, { dedupeKey: "project-layout" });
		expect(add.mock.calls[0]?.[0]).toMatchObject({
			id: "project-layout",
			type: "error",
			title: presentFailure({ code: "request.failed", retryable: true }, locales.en).title,
			timeout: undefined,
			priority: undefined,
			actionProps: undefined,
			data: { copyText: undefined },
		});
		add.mockRestore();
	});

	test("keeps a toast with detail or a handled action until dismissed", () => {
		const add = spyOn(toast, "add").mockReturnValue("toast-id");
		const onAction = mock(() => {});
		notifyFailure(
			{ code: "connection.restart_failed", retryable: true, action: "reconnect", detail: "socket closed" },
			locales.en,
			{ onAction },
		);
		const options = add.mock.calls[0]?.[0];
		expect(options).toMatchObject({ timeout: 0, priority: "high", data: { copyText: "socket closed" } });
		(options?.actionProps?.onClick as () => void)();
		expect(onAction).toHaveBeenCalledWith("reconnect");
		add.mockRestore();
	});

	test("names the failed action in the title while the code still decides persistence and Copy", () => {
		const add = spyOn(toast, "add").mockReturnValue("toast-id");
		notifyFailure({ code: "provider.auth_failed", retryable: false, detail: "status=401" }, locales["zh-CN"], {
			title: "无法重命名会话",
			dedupeKey: "session-rename:s1",
		});
		expect(add.mock.calls[0]?.[0]).toMatchObject({
			id: "session-rename:s1",
			title: "无法重命名会话",
			description: presentFailure({ code: "provider.auth_failed", retryable: false }, locales["zh-CN"]).description,
			timeout: 0,
			priority: "high",
			data: { copyText: "status=401" },
		});
		add.mockRestore();
	});
});
