import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { McpStatusTable } from "../src/components/shell/settings/mcp-settings";
import enMessages from "../src/i18n/compiled/en.json";
import zhCnMessages from "../src/i18n/compiled/zh-CN.json";
import { getDesktopRemoteRpcFailure } from "../src/lib/desktop";
import { desktopQueryClient, desktopQueryKeys, reorderProjects, setProjectExpanded } from "../src/lib/desktop-query";
import { useThemeStore } from "../src/stores/theme";

const globals = globalThis as { window?: unknown; document?: unknown };
const originalWindow = globals.window;
const originalDocument = globals.document;

function rejectEveryRpc(): string[] {
	const paths: string[] = [];
	globals.window = {
		matchMedia: () => ({ matches: false }),
		desktopRpc: {
			invoke: async ({ path }: { path: string }) => {
				paths.push(path);
				return {
					status: "error",
					error: { _tag: "desktop_test.failed", message: "", failure: { code: "request.failed", retryable: true } },
				};
			},
		},
	};
	globals.document = { documentElement: { classList: { toggle: () => {} } } };
	return paths;
}

afterEach(() => {
	globals.window = originalWindow;
	globals.document = originalDocument;
	desktopQueryClient.clear();
});

describe("user action failures reach the caller", () => {
	test("project reorder and expand reject after resyncing the optimistic layout", async () => {
		const paths = rejectEveryRpc();
		desktopQueryClient.setQueryData(desktopQueryKeys.projects, []);

		for (const request of [reorderProjects(["project-1"]), setProjectExpanded("project-1", true)]) {
			const error = await request.then(
				() => expect.unreachable("request should reject"),
				(cause: unknown) => cause,
			);
			expect(getDesktopRemoteRpcFailure(error)).toEqual({ code: "request.failed", retryable: true });
		}
		expect(paths).toContain("project.reorder");
		expect(paths).toContain("project.setExpanded");
		expect(desktopQueryClient.getQueryState(desktopQueryKeys.projects)?.isInvalidated).toBe(true);
	});

	test("theme applies immediately and rejects when it cannot be saved", async () => {
		rejectEveryRpc();
		const error = await useThemeStore
			.getState()
			.setTheme("dark")
			.then(
				() => expect.unreachable("theme save should reject"),
				(cause: unknown) => cause,
			);
		expect(useThemeStore.getState().theme).toBe("dark");
		expect(getDesktopRemoteRpcFailure(error).code).toBe("request.failed");
	});
});

describe("McpStatusTable", () => {
	const render = (failed: boolean) =>
		renderToStaticMarkup(
			<IntlProvider locale="en" messages={enMessages}>
				<McpStatusTable loading={false} failed={failed} />
			</IntlProvider>,
		);

	test("a failed refresh says so instead of claiming there are no servers", () => {
		const markup = render(true);
		expect(markup).toContain('role="alert"');
		expect(markup).toContain("Could not refresh MCP server status.");
		expect(markup).not.toContain("No MCP servers configured.");
	});

	test("an empty successful refresh still shows the empty state", () => {
		expect(render(false)).toContain("No MCP servers configured.");
	});

	test("a server that failed to connect shows localized copy as an alert, not the Host's English sentence", () => {
		const status = {
			servers: [
				{
					name: "docs",
					type: "stdio" as const,
					connected: false,
					toolCount: 0,
					error: 'Could not connect to MCP server "docs"',
				},
			],
		};
		for (const [locale, messages, text] of [
			["en", enMessages, "Could not connect to this server."],
			["zh-CN", zhCnMessages, "无法连接此服务器。"],
		] as const) {
			const markup = renderToStaticMarkup(
				<IntlProvider locale={locale} messages={messages}>
					<McpStatusTable status={status} loading={false} failed={false} />
				</IntlProvider>,
			);
			expect(markup).toContain(`role="alert">${text}<`);
			expect(markup).not.toContain("Could not connect to MCP server");
		}
	});
});
