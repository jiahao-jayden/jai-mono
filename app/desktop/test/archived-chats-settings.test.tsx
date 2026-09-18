import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { IntlProvider } from "react-intl";
import { renderToStaticMarkup } from "react-dom/server";
import enMessages from "../src/i18n/compiled/en.json";
import { ArchivedChatsSettings } from "../src/components/shell/settings/archived-chats-settings";
import { desktopQueryKeys } from "../src/lib/desktop-query";

describe("ArchivedChatsSettings", () => {
	test("独立展示归档会话、项目名和恢复操作", () => {
		const client = new QueryClient();
		client.setQueryData(desktopQueryKeys.projects, [
			{
				id: "project-1",
				displayName: "jai-mono",
				path: "/jai-mono",
				canonicalPath: "/jai-mono",
				available: true,
				createdAt: 1,
				updatedAt: 1,
			},
		]);
		client.setQueryData(desktopQueryKeys.sessions.archived, {
			pages: [
				{
					sessions: [
						{
							id: "newer",
							projectId: "project-1",
							title: "Newer archived chat",
							titleSource: "manual",
							lastActivityAt: 2,
							archivedAt: 2,
						},
						{
							id: "older",
							projectId: null,
							title: "Older archived chat",
							titleSource: "manual",
							lastActivityAt: 1,
							archivedAt: 1,
						},
					],
					runningSessionIds: [],
				},
			],
			pageParams: [undefined],
		});

		const markup = renderToStaticMarkup(
			<QueryClientProvider client={client}>
				<IntlProvider locale="en" messages={enMessages}>
					<ArchivedChatsSettings />
				</IntlProvider>
			</QueryClientProvider>,
		);

		expect(markup).toContain("Newer archived chat");
		expect(markup).toContain("jai-mono");
		expect(markup).toContain(">Restore<");
		expect(markup).toContain(">Delete<");
		expect(markup.indexOf("Newer archived chat")).toBeLessThan(markup.indexOf("Older archived chat"));
	});

	test("保留服务端归档分页顺序并提供加载更多操作", () => {
		const client = new QueryClient();
		const firstPage = Array.from({ length: 50 }, (_, index) => ({
			id: `page-one-${index}`,
			projectId: null,
			title: `Archived chat ${index}`,
			titleSource: "manual" as const,
			lastActivityAt: 1_000 - index,
			archivedAt: 10_000 - index,
		}));
		firstPage[0] = {
			id: "older-chat-archived-later",
			projectId: null,
			title: "Older chat archived later",
			titleSource: "manual",
			lastActivityAt: 1,
			archivedAt: 20_000,
		};
		client.setQueryData(desktopQueryKeys.sessions.archived, {
			pages: [
				{
					sessions: firstPage,
					nextCursor: { lastActivityAt: 9_951, id: "page-one-49" },
					runningSessionIds: [],
				},
				{
					sessions: [
						{
							id: "page-two-1",
							projectId: null,
							title: "Later page chat",
							titleSource: "manual",
							lastActivityAt: 0,
							archivedAt: 9_950,
						},
					],
					nextCursor: { lastActivityAt: 9_950, id: "page-two-1" },
					runningSessionIds: [],
				},
			],
			pageParams: [undefined, { lastActivityAt: 9_951, id: "page-one-49" }],
		});

		const markup = renderToStaticMarkup(
			<QueryClientProvider client={client}>
				<IntlProvider locale="en" messages={enMessages}>
					<ArchivedChatsSettings />
				</IntlProvider>
			</QueryClientProvider>,
		);

		expect(markup).toContain("Later page chat");
		expect(markup).toContain(">Load more<");
		expect(markup.indexOf("Older chat archived later")).toBeLessThan(markup.indexOf("Later page chat"));
	});
});
