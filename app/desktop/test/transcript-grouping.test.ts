import { describe, expect, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { createIntl, IntlProvider } from "react-intl";
import { renderToStaticMarkup as renderToStaticMarkupBase } from "react-dom/server";
import enMessages from "../src/i18n/compiled/en.json";
import type { DesktopTranscriptItem } from "../shared/desktop-rpc";
import {
	groupTranscriptItems,
	TranscriptItem,
	TranscriptItems,
	formatWorkDuration,
	workTimelineSummary,
	workTimelineSteps,
} from "../src/components/shell/chat/chat-transcript";
import { MarkdownContent } from "../src/components/ui/chat-message";

const intl = createIntl({ locale: "en", messages: enMessages });

function renderToStaticMarkup(node: ReactNode): string {
	return renderToStaticMarkupBase(createElement(IntlProvider, { locale: "en", messages: enMessages }, node));
}

describe("transcript grouping", () => {
	test("只将明确的 compaction item 渲染为上下文压缩", () => {
		const compaction: DesktopTranscriptItem = {
			kind: "compaction",
			id: "compaction:1",
			summary: "Earlier context",
			timestamp: 1,
			status: "complete",
		};
		const staleProgress = {
			kind: "progress",
			id: "progress:1",
			title: "Working",
			detail: "From an older main process",
		};

		expect(renderToStaticMarkup(createElement(TranscriptItem, { item: compaction }))).toContain("Context compacted");
		expect(
			renderToStaticMarkup(
				createElement(TranscriptItem, { item: staleProgress as unknown as DesktopTranscriptItem }),
			),
		).toBe("");
	});

	test("单个工具使用 ToolTimeline 渲染", () => {
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:search-1",
			turnId: "turn-1",
			activityId: "assistant:1",
			toolCallId: "search-1",
			toolName: "grep",
			activityKind: "search",
			status: "complete",
			startedAt: 0,
			completedAt: 61_000,
			summary: "chat-transcript.tsx",
			details: "command output",
		};

		const markup = renderToStaticMarkup(createElement(TranscriptItem, { item: tool }));
		expect(markup).toContain('data-slot="tool-timeline"');
		expect(markup).toContain("Worked for 1m");
		expect(markup).not.toContain("command output");
	});

	test("Markdown 表格渲染在独立横向滚动容器中", () => {
		const markup = renderToStaticMarkup(
			createElement(MarkdownContent, {
				content: "| Rust | 说明 |\n| --- | --- |\n| `arr.len()` | 长度 |",
			}),
		);

		expect(markup).toContain('data-streamdown="table-wrapper"');
		expect(markup).toContain('data-streamdown="table"');
	});

	test("子代理和同一轮的工具合并进同一个 ToolTimeline，每个子代理独占一行", () => {
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:bash-1",
			turnId: "turn-1",
			activityId: "assistant:1",
			toolCallId: "bash-1",
			toolName: "Bash",
			activityKind: "execute",
			status: "complete",
			startedAt: 0,
			completedAt: 90_000,
		};
		const subagent: Extract<DesktopTranscriptItem, { kind: "subagent" }> = {
			kind: "subagent",
			id: "subagent:call-1",
			turnId: "turn-1",
			toolCallId: "call-1",
			title: "Inspect desktop",
			status: "running",
			startedAt: 30_000,
			activityTitle: "Read",
		};

		expect(groupTranscriptItems([tool, subagent])).toEqual([{ id: "work:turn-1:tool:bash-1", items: [tool, subagent] }]);
		const steps = workTimelineSteps([tool, subagent], intl, { onOpenSubagent: () => {} });
		expect(steps).toHaveLength(2);
		expect(steps[1]).toMatchObject({ title: "Inspect desktop", summary: "Read", active: true });
		expect(steps[1]?.onSelect).toBeFunction();
		expect(workTimelineSummary([tool, subagent], [tool, subagent], true, intl, 90_000)).toBe("Working · 1m 30s");

		const markup = renderToStaticMarkup(
			createElement(TranscriptItems, { items: [tool, subagent], loading: false, onOpenSubagent: () => {} }),
		);
		expect(markup).toContain("Inspect desktop");
		expect(markup).toContain("<svg");
	});

	test("工具展示层为主要类别使用稳定的 Hugeicons 语义映射", () => {
		const categories = [
			["search", "search-code"],
			["read", "file-search"],
			["write", "file-edit"],
			["execute", "command"],
			["call", "api"],
			["operation", "workflow"],
		] as const;
		for (const [activityKind, icon] of categories) {
			const tool = {
				kind: "tool",
				id: `tool:${activityKind}`,
				turnId: "turn-1",
				activityId: `activity:${activityKind}`,
				toolCallId: `call:${activityKind}`,
				toolName: `unknown_${activityKind}`,
				activityKind,
				status: "complete",
			} satisfies Extract<DesktopTranscriptItem, { kind: "tool" }>;
			expect(workTimelineSteps([tool], intl)[0]).toMatchObject({ icon, density: "compact" });
		}
	});

	test("未知工具使用可读标题和 operation fallback", () => {
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:unknown",
			turnId: "turn-1",
			activityId: "activity:unknown",
			toolCallId: "call:unknown",
			toolName: "mcp__listResources",
			activityKind: "operation",
			status: "complete",
		};
		expect(workTimelineSteps([tool], intl)[0]).toMatchObject({ title: "Ran", summary: "List Resources", icon: "workflow" });
	});

	test("失败子代理保留可选择行并显示失败状态", () => {
		const subagent: Extract<DesktopTranscriptItem, { kind: "subagent" }> = {
			kind: "subagent",
			id: "subagent:error",
			turnId: "turn-1",
			toolCallId: "call:error",
			title: "Inspect desktop",
			status: "error",
		};
		const step = workTimelineSteps([subagent], intl, { onOpenSubagent: () => {} })[0];
		expect(step).toMatchObject({ title: "Inspect desktop", summary: "Failed", icon: "users", density: "compact" });
		expect(step?.onSelect).toBeFunction();
	});

	test("普通搜索工具不会进入 Web Search 来源渲染", () => {
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:connector-search-1",
			turnId: "turn-1",
			activityId: "assistant:1",
			toolCallId: "connector-search-1",
			toolName: "Search Tools",
			activityKind: "search",
			status: "complete",
			searchQuery: "weather",
			details: "Search completed",
		};

		const steps = workTimelineSteps([tool], intl);
		expect(steps[0]?.webSearchResults).toBeUndefined();
		expect(steps[0]?.searchQuery).toBeUndefined();
		expect(renderToStaticMarkup(createElement(TranscriptItem, { item: tool }))).not.toContain(
			'data-slot="web-search-results"',
		);
	});

	test("Web Search 逐行渲染可打开的来源结果", () => {
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:web-search-1",
			turnId: "turn-1",
			activityId: "assistant:1",
			toolCallId: "web-search-1",
			toolName: "Search web for release notes",
			activityKind: "search",
			status: "complete",
			searchQuery: "Jai release notes",
			webSearchResults: [
				{ title: "Jai releases", url: "https://example.com/releases" },
				{ title: "Jai changelog", url: "https://docs.example.com/changelog" },
			],
		};

		const markup = renderToStaticMarkup(
			createElement(TranscriptItems, { items: [tool], loading: false, responding: true }),
		);
		expect(markup).toContain('data-slot="web-search-results"');
		expect(markup).toContain("Search web for release notes");
		expect(markup).not.toContain("Jai release notes");
		expect(markup).toContain("Jai releases");
		expect(markup).toContain("Jai changelog");
		expect(markup).toContain('href="https://example.com/releases"');
		expect(markup).toContain('src="https://example.com/favicon.ico"');
		expect(markup).not.toContain("Web Search · Web Search");
	});

	test("Web Search 使用关键词作为通用工具名的结果标题", () => {
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:web-search-query-1",
			turnId: "turn-1",
			activityId: "assistant:1",
			toolCallId: "web-search-query-1",
			toolName: "web_search",
			activityKind: "search",
			status: "complete",
			searchQuery: "latest AI news",
			webSearchResults: [{ title: "AI Daily", url: "https://example.com/ai-daily" }],
		};

		expect(workTimelineSteps([tool], intl)[0]?.title).toBe("latest AI news");
	});

	test("同一运行内的工具只形成一个外层工作过程", () => {
		const firstTool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:read-1",
			turnId: "operation-1",
			activityId: "tool:read-1",
			toolCallId: "read-1",
			toolName: "Read",
			activityKind: "read",
			status: "complete",
			startedAt: 0,
			completedAt: 61_000,
		};
		const secondTool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			...firstTool,
			id: "tool:search-1",
			activityId: "tool:search-1",
			toolCallId: "search-1",
			toolName: "Grep",
			activityKind: "search",
		};

		expect(groupTranscriptItems([firstTool, secondTool])).toEqual([
			{ id: "work:operation-1:tool:read-1", items: [firstTool, secondTool] },
		]);
		const markup = renderToStaticMarkup(
			createElement(TranscriptItems, { items: [firstTool, secondTool], loading: false }),
		);
		expect(markup).toContain("Worked for 1m");
		expect((markup.match(/data-slot=\"tool-timeline\"/g) ?? []).length).toBe(1);
	});

	test("工作过程追加条目时保留首个 row identity", () => {
		const firstTool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:read-1",
			turnId: "operation-1",
			activityId: "tool:read-1",
			toolCallId: "read-1",
			toolName: "Read",
			activityKind: "read",
			status: "complete",
		};
		const nextTool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			...firstTool,
			id: "tool:search-1",
			activityId: "tool:search-1",
			toolCallId: "search-1",
			toolName: "Grep",
			activityKind: "search",
		};

		const initialRows = groupTranscriptItems([firstTool]);
		const updatedRows = groupTranscriptItems([firstTool, nextTool]);

		expect(updatedRows[0]?.id).toBe(initialRows[0]?.id);
		expect(updatedRows[0]).toMatchObject({ items: [firstTool, nextTool] });
	});

	test("已完成的工具显示从开始到结束的工作时长", () => {
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:write-1",
			turnId: "turn-1",
			activityId: "assistant:1",
			toolCallId: "write-1",
			toolName: "Write",
			activityKind: "write",
			status: "complete",
			startedAt: 0,
			completedAt: 61_000,
			fileChanges: [{ operation: "add", path: "/workspace/index.ts" }],
		};

		expect(workTimelineSummary([tool], [tool], false, intl)).toBe("Worked for 1m 1s");
	});

	test("缺少 activity 时间戳的已完成工作不会从用户消息计时到现在", () => {
		const user: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:user-1",
			role: "user",
			text: "检查一下",
			status: "complete",
			timestamp: 0,
		};
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:read-1",
			turnId: "turn-1",
			activityId: "assistant:1",
			toolCallId: "read-1",
			toolName: "Read",
			activityKind: "read",
			status: "complete",
		};

		expect(workTimelineSummary([user, tool], [tool], false, intl, 16 * 60 * 60 * 1_000)).toBe("Worked");
	});

	test("零时长工作不会伪装成 1ms", () => {
		const thinking: Extract<DesktopTranscriptItem, { kind: "thinking" }> = {
			kind: "thinking",
			id: "thinking:instant",
			turnId: "turn-instant",
			activityId: "activity:instant",
			text: "",
			status: "complete",
			timestamp: 10_000,
		};

		expect(workTimelineSummary([thinking], [thinking], false, intl)).toBe("Worked");
	});

	test("工作时长使用本地化的紧凑单位", () => {
		expect(formatWorkDuration(400, intl)).toBe("1s");
		expect(formatWorkDuration(9_800, intl)).toBe("10s");
		expect(formatWorkDuration(3 * 60_000 + 27_000, intl)).toBe("3m 27s");
		expect(formatWorkDuration(16 * 60 * 60_000 + 17 * 60_000 + 55_000, intl)).toBe("16h 17m 55s");
	});

	test("不会把本轮用户消息之前的旧工具时间算进工作时长", () => {
		const user: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:user-stale-clock",
			role: "user",
			text: "检查一下",
			status: "complete",
			timestamp: 100_000,
		};
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:stale-clock",
			turnId: "turn-stale-clock",
			activityId: "assistant:stale-clock",
			toolCallId: "stale-clock",
			toolName: "Read",
			activityKind: "read",
			status: "complete",
			startedAt: 0,
			completedAt: 101_000,
		};
		const reply: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:reply-stale-clock",
			role: "assistant",
			text: "完成了。",
			status: "complete",
			timestamp: 102_000,
		};

		expect(workTimelineSummary([user, tool, reply], [tool], false, intl)).toBe("Worked for 2s");
	});

	test("不会把助手回复之后的旧工具结束时间算进工作时长", () => {
		const user: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:user-end-boundary",
			role: "user",
			text: "检查一下",
			status: "complete",
			timestamp: 100_000,
		};
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:end-boundary",
			turnId: "turn-end-boundary",
			activityId: "assistant:end-boundary",
			toolCallId: "end-boundary",
			toolName: "Read",
			activityKind: "read",
			status: "complete",
			startedAt: 101_000,
			completedAt: 500_000,
		};
		const reply: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:reply-end-boundary",
			role: "assistant",
			text: "完成了。",
			status: "complete",
			timestamp: 102_000,
		};

		expect(workTimelineSummary([user, tool, reply], [tool], false, intl)).toBe("Worked for 2s");
	});

	test("context compaction 不会切断同一 turn 的工作日志", () => {
		const firstTool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:1",
			turnId: "turn-1",
			activityId: "assistant:1",
			toolCallId: "call-1",
			toolName: "Read",
			activityKind: "read",
			status: "complete",
		};
		const compaction: Extract<DesktopTranscriptItem, { kind: "compaction" }> = {
			kind: "compaction",
			id: "compaction:1",
			summary: "Earlier context",
			timestamp: 1,
			status: "complete",
		};
		const nextTool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			...firstTool,
			id: "tool:2",
			activityId: "assistant:2",
			toolCallId: "call-2",
			toolName: "Bash",
			activityKind: "execute",
		};

		expect(groupTranscriptItems([firstTool, compaction, nextTool])).toEqual([
			{ id: "work:turn-1:tool:1", items: [firstTool, nextTool] },
		]);
		expect(groupTranscriptItems([firstTool, compaction])).toEqual([
			{ id: "work:turn-1:tool:1", items: [firstTool] },
		]);
	});

	test("MCP 工具无论名称或操作类型都聚合为外部调用", () => {
		const items: DesktopTranscriptItem[] = [
			{
				kind: "message",
				id: "message:user-1",
				role: "user",
				text: "查询外部服务的数据",
				status: "complete",
				timestamp: 1,
			},
			{
				kind: "narration",
				id: "message:assistant-1:0",
				turnId: "message:user-1",
				activityId: "message:assistant-1",
				text: "我先确认有哪些可用操作。",
				status: "complete",
				timestamp: 2,
			},
			{
				kind: "tool",
				id: "tool:list-apps",
				turnId: "message:user-1",
				activityId: "message:assistant-1",
				toolCallId: "list-apps",
				toolName: "mcp__ext__srv__list_apps",
				activityKind: "call",
				status: "complete",
			},
			{
				kind: "tool",
				id: "tool:list-connections",
				turnId: "message:user-1",
				activityId: "message:assistant-1",
				toolCallId: "list-connections",
				toolName: "mcp__ext__srv__list_connections",
				activityKind: "call",
				status: "complete",
			},
			{
				kind: "narration",
				id: "message:assistant-2:0",
				turnId: "message:user-1",
				activityId: "message:assistant-2",
				text: "连接已就绪，继续执行。",
				status: "complete",
				timestamp: 3,
			},
			{
				kind: "tool",
				id: "tool:search-actions",
				turnId: "message:user-1",
				activityId: "message:assistant-2",
				toolCallId: "search-actions",
				toolName: "mcp__ext__srv__search_things",
				activityKind: "call",
				status: "complete",
				summary: "pending records",
			},
			{
				kind: "tool",
				id: "tool:search-messages",
				turnId: "message:user-1",
				activityId: "message:assistant-3",
				toolCallId: "search-messages",
				toolName: "mcp__ext__srv__search_things",
				activityKind: "call",
				status: "complete",
				summary: "messages",
			},
			{
				kind: "tool",
				id: "tool:search-list",
				turnId: "message:user-1",
				activityId: "message:assistant-3",
				toolCallId: "search-list",
				toolName: "mcp__ext__srv__search_things",
				activityKind: "call",
				status: "complete",
				summary: "list",
			},
			{
				kind: "message",
				id: "message:assistant-final",
				role: "assistant",
				text: "查询完成。",
				status: "complete",
				timestamp: 4,
				stopReason: "stop",
			},
		];

		const rows = groupTranscriptItems(items);
		expect(rows).toHaveLength(3);
		expect(rows[1]).toMatchObject({ id: "work:message:user-1:message:assistant-1:0" });

		const markup = renderToStaticMarkup(createElement(TranscriptItems, { items, loading: false }));
		expect(markup).toContain("Worked");
		const tools = items.filter(
			(item): item is Extract<DesktopTranscriptItem, { kind: "tool" }> => item.kind === "tool",
		);
		expect(workTimelineSteps(tools, intl)).toMatchObject([
			{ title: "Called", summary: "2 calls" },
			{ title: "Called", summary: "pending records" },
			{ title: "Called", summary: "2 calls" },
		]);
		expect((markup.match(/data-slot="tool-timeline"/g) ?? []).length).toBe(1);
	});

	test("Connector 工具统一显示为外部调用", () => {
		const tool = (
			id: string,
			toolName: string,
			activityKind: Extract<DesktopTranscriptItem, { kind: "tool" }>["activityKind"],
			summary?: string,
		): Extract<DesktopTranscriptItem, { kind: "tool" }> => ({
			kind: "tool",
			id: `tool:${id}`,
			turnId: "message:user-1",
			activityId: "message:assistant-1",
			toolCallId: id,
			toolName,
			activityKind,
			status: "complete",
			...(summary ? { summary } : {}),
		});

		const tools = [
			tool("list-apps", "connector__list_apps", "call", "apps"),
			tool("search-actions", "connector__search_actions", "call", "pending records"),
			tool("read-mail", "connector__execute_action", "call", "google_gmail.list_messages"),
			tool("send-mail", "connector__execute_action", "call", "google_gmail.send_message"),
			tool("purge", "connector__execute_action", "call", "google_gmail.purge"),
		];

		expect(workTimelineSteps(tools, intl)).toMatchObject([
			{ title: "Called", summary: "5 calls" },
		]);
	});

	test("回复文本仍然是工作阶段的顺序屏障", () => {
		const thinking: Extract<DesktopTranscriptItem, { kind: "thinking" }> = {
			kind: "thinking",
			id: "thinking:1",
			turnId: "turn-1",
			activityId: "message:assistant-1",
			text: "Analyze first",
			status: "complete",
			timestamp: 1,
		};
		const reply: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:reply",
			role: "assistant",
			text: "先说说当前版本的分析，再动手。",
			status: "complete",
			timestamp: 2,
		};
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:1",
			turnId: "turn-1",
			activityId: "message:assistant-2",
			toolCallId: "call-1",
			toolName: "Bash",
			activityKind: "execute",
			status: "complete",
		};

		expect(groupTranscriptItems([thinking, reply, tool])).toEqual([
			{ id: "work:turn-1:thinking:1", items: [thinking] },
			reply,
			{ id: "work:turn-1:tool:1", items: [tool] },
		]);
	});

	test("skips permission items because they render in the composer approval card", () => {
		const permission: Extract<DesktopTranscriptItem, { kind: "permission" }> = {
			kind: "permission",
			id: "permission:tool-1",
			request: {
				requestId: "tool-1",
				sessionId: "session-1",
				toolCallId: "tool-1",
				toolName: "Bash",
				reason: "needs approval",
				summary: { title: "Run bun test" },
			},
			status: "pending",
			requestedAt: 1,
		};
		const reply: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:reply",
			role: "assistant",
			text: "需要先批准这条命令。",
			status: "complete",
			timestamp: 1,
		};

		expect(groupTranscriptItems([reply, permission])).toEqual([reply]);
		expect(renderToStaticMarkup(createElement(TranscriptItem, { item: permission }))).toBe("");
	});

	test("工作时长按 turn boundary 到 assistant 完成时间计算", () => {
		const user: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:user-1",
			role: "user",
			text: "搜一下",
			status: "complete",
			timestamp: 0,
		};
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:search-1",
			turnId: "operation-1",
			activityId: "assistant:1",
			toolCallId: "search-1",
			toolName: "grep",
			activityKind: "search",
			status: "complete",
			startedAt: 20_000,
			completedAt: 40_000,
		};
		const reply: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:reply",
			role: "assistant",
			text: "搜完了。",
			status: "complete",
			timestamp: 70_000,
		};

		expect(workTimelineSummary([user, tool, reply], [tool], false, intl)).toBe("Worked for 1m 10s");
		expect(workTimelineSummary([user, tool], [tool], true, intl, 55_000)).toBe("Working · 55s");
		expect(
			workTimelineSummary([user, tool, { ...reply, status: "streaming", timestamp: 45_000 }], [tool], true, intl, 70_000),
		).toBe("Worked for 40s");

		const activeMarkup = renderToStaticMarkup(
			createElement(TranscriptItems, { items: [user, tool], loading: false, responding: true }),
		);
		expect(activeMarkup).toContain('aria-expanded="true"');

		const completedMarkup = renderToStaticMarkup(
			createElement(TranscriptItems, { items: [user, tool, reply], loading: false }),
		);
		expect(completedMarkup).toContain('aria-expanded="false"');

		const rememberedMarkup = renderToStaticMarkup(
			createElement(TranscriptItems, {
				items: [user, tool, reply],
				loading: false,
				openWorkGroups: new Set(["session-1:work:operation-1:tool:search-1"]),
				workGroupKeyPrefix: "session-1",
			}),
		);
		expect(rememberedMarkup).toContain('aria-expanded="true"');
	});

	test("工具调用前的 assistant 消息不会覆盖用户消息作为 turn 起点", () => {
		const user: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:user-1",
			role: "user",
			text: "检查一下",
			status: "complete",
			timestamp: 1_000,
		};
		const toolRequest: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:tool-request",
			role: "assistant",
			text: "我先检查。",
			status: "complete",
			timestamp: 1_001,
		};
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:read-1",
			turnId: "operation-1",
			activityId: "assistant:1",
			toolCallId: "read-1",
			toolName: "Read",
			activityKind: "read",
			status: "complete",
			startedAt: 2_000,
			completedAt: 61_000,
		};
		const reply: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:reply",
			role: "assistant",
			text: "完成了。",
			status: "complete",
			timestamp: 62_000,
		};

		expect(workTimelineSummary([user, toolRequest, tool, reply], [tool], false, intl)).toBe("Worked for 1m 1s");
	});

	test("回放时不混用当前消息时间和 journal 工具时间", () => {
		const now = 1_800_000_000_000;
		const user: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:user-replayed",
			role: "user",
			text: "检查一下",
			status: "complete",
			timestamp: now,
		};
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:read-replayed",
			turnId: "operation-replayed",
			activityId: "assistant:replayed",
			toolCallId: "read-replayed",
			toolName: "Read",
			activityKind: "read",
			status: "complete",
			startedAt: 10_000,
			completedAt: 71_000,
		};
		const reply: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:reply-replayed",
			role: "assistant",
			text: "完成了。",
			status: "complete",
			timestamp: now + 1,
		};

		expect(workTimelineSummary([user, tool, reply], [tool], false, intl, now + 2)).toBe("Worked for 1m 1s");
	});

	test("回放工具组使用 durable request 和 run 时间", () => {
		const user: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:user-replayed-narration",
			role: "user",
			text: "查询 Jev",
			status: "complete",
			timestamp: 0,
		};
		const narration: Extract<DesktopTranscriptItem, { kind: "narration" }> = {
			kind: "narration",
			id: "message:narration-replayed",
			turnId: "turn-replayed-narration",
			activityId: "activity-replayed-narration",
			text: "我查一下。",
			status: "complete",
			timestamp: 15_000,
		};
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:replayed-narration",
			turnId: "turn-replayed-narration",
			activityId: "activity-replayed-narration",
			toolCallId: "replayed-narration",
			toolName: "web_search",
			activityKind: "search",
			status: "complete",
			startedAt: 10_000,
			completedAt: 24_000,
		};
		const reply: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:reply-replayed-narration",
			role: "assistant",
			text: "查到了。",
			status: "complete",
			timestamp: 25_000,
		};

		expect(workTimelineSummary([user, narration, tool, reply], [narration, tool], false, intl, 26_000)).toBe("Worked for 25s");
	});

	test("回放工具缺少完成时间时不伪造超长时长", () => {
		const now = 1_800_000_000_000;
		const user: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message", id: "message:user-missing-end", role: "user", text: "检查", status: "complete", timestamp: now,
		};
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool", id: "tool:missing-end", turnId: "operation-missing-end", activityId: "assistant:missing-end",
			toolCallId: "missing-end", toolName: "Read", activityKind: "read", status: "complete", startedAt: 10_000,
		};

		expect(workTimelineSummary([user, tool], [tool], false, intl, now)).toBe("Worked");
	});

	test("权限审批等待不计入工作时长，未完成时数字冻结", () => {
		const user: Extract<DesktopTranscriptItem, { kind: "message" }> = {
			kind: "message",
			id: "message:user-1",
			role: "user",
			text: "跑测试",
			status: "complete",
			timestamp: 0,
		};
		const tool: Extract<DesktopTranscriptItem, { kind: "tool" }> = {
			kind: "tool",
			id: "tool:bash-1",
			turnId: "operation-1",
			activityId: "assistant:1",
			toolCallId: "bash-1",
			toolName: "Bash",
			activityKind: "execute",
			status: "running",
			startedAt: 10_000,
		};
		const pending: Extract<DesktopTranscriptItem, { kind: "permission" }> = {
			kind: "permission",
			id: "permission:bash-1",
			request: {
				requestId: "bash-1",
				sessionId: "session-1",
				toolCallId: "bash-1",
				toolName: "Bash",
				reason: "needs approval",
				summary: { title: "Run bun test" },
			},
			status: "pending",
			requestedAt: 15_000,
		};
		const resolved = { ...pending, status: "allowed" as const, resolvedAt: 45_000 };

		expect(workTimelineSummary([user, pending, tool], [tool], true, intl, 40_000)).toBe("Working · 15s");
		expect(workTimelineSummary([user, pending, tool], [tool], true, intl, 80_000)).toBe("Working · 15s");
		expect(workTimelineSummary([user, resolved, tool], [tool], true, intl, 80_000)).toBe("Working · 50s");
	});
});
