import { describe, expect, test } from "bun:test";
import { Toast, type ToastManagerAddOptions } from "@base-ui/react/toast";
import { IntlProvider } from "react-intl";
import { renderToStaticMarkup } from "react-dom/server";
import enMessages from "../src/i18n/compiled/en.json";
import { type ToastData, ToastList } from "../src/components/ui/toast";

// The manager only reaches the store after mount, so server rendering seeds the store directly.
function Seed({ toasts }: { toasts: ToastManagerAddOptions<ToastData>[] }) {
	const manager = Toast.useToastManager<ToastData>();
	for (const options of toasts) manager.add(options);
	return null;
}

function render(toasts: ToastManagerAddOptions<ToastData>[]): string {
	return renderToStaticMarkup(
		<IntlProvider locale="en" messages={enMessages}>
			<Toast.Provider>
				<Seed toasts={toasts} />
				<ToastList />
			</Toast.Provider>
		</IntlProvider>,
	);
}

describe("Toast", () => {
	test("没有操作时使用紧凑布局且不渲染 description", () => {
		const markup = render([{ title: "Renamed", description: "Hidden detail", type: "success" }]);
		expect(markup).toContain("data-compact");
		expect(markup).toContain("Renamed");
		expect(markup).not.toContain("Hidden detail");
	});

	test("带 copyText 时使用完整布局并渲染 Copy 与 description", () => {
		const markup = render([
			{ title: "Request failed", description: "Try again later", type: "error", data: { copyText: "HTTP 502" } },
		]);
		expect(markup).not.toContain("data-compact");
		expect(markup).toContain("Try again later");
		expect(markup).toContain(">Copy<");
	});

	test("同一 id 连续 add 只保留一条并原地更新", () => {
		const markup = render([
			{ id: "rename-failed", title: "First", type: "error" },
			{ id: "rename-failed", title: "Second", type: "error" },
		]);
		expect(markup.match(/data-slot="toast"/g)?.length).toBe(1);
		expect(markup).toContain("Second");
		expect(markup).not.toContain("First");
	});
});
