import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { EMPTY_DESKTOP_SESSION_USAGE } from "../shared/desktop-rpc";
import { defaultDesktopSessionControls } from "../shared/session-controls";
import { ChatColumn } from "../src/components/shell/chat/chat-column";
import { ComposerNotice } from "../src/components/shell/chat/composer-notice";
import type { Chat, ChatNotice } from "../src/hooks/use-chat";
import enMessages from "../src/i18n/compiled/en.json";

function render(notice: ChatNotice | undefined): string {
	return renderToStaticMarkup(
		<IntlProvider locale="en" messages={enMessages}>
			<ComposerNotice
				notice={notice}
				onDismiss={() => {}}
				onRetry={async () => undefined}
				onReconnect={() => {}}
				onOpenProviderSettings={() => {}}
			/>
		</IntlProvider>,
	);
}

describe("ComposerNotice", () => {
	test("Operation 失败卡片带标题、说明、复制详情、建议操作、重试和关闭", () => {
		const markup = render({
			kind: "operation",
			operationId: "op-1",
			failure: {
				code: "provider.auth_failed",
				retryable: false,
				action: "open_provider_settings",
				detail: "HTTP 502: 401 OAuth access token is invalid",
			},
		});

		expect(markup).toContain('role="alert"');
		expect(markup).toContain("Model authentication failed");
		expect(markup).toContain(enMessages["desktop.failure.providerAuthFailed.description"]);
		expect(markup).toContain("Copy details");
		expect(markup).toContain(enMessages["desktop.failure.action.openProviderSettings"]);
		expect(markup).toContain(">Retry<");
		expect(markup).toContain('aria-label="Close"');
		expect(markup).not.toContain("OAuth access token");
	});

	test("没有建议操作也不可重试的失败只保留关闭", () => {
		const markup = render({
			kind: "operation",
			operationId: "op-2",
			failure: { code: "provider.context_overflow", retryable: false },
		});

		expect(markup).not.toContain(">Retry<");
		expect(markup).not.toContain("Copy details");
		expect(markup).toContain('aria-label="Close"');
	});

	test("重连中用 role=status 且不可关闭；重启失败提供重试连接", () => {
		const reconnecting = render({ kind: "connection", status: "reconnecting" });
		expect(reconnecting).toContain('role="status"');
		expect(reconnecting).not.toContain('aria-label="Close"');

		const restartFailed = render({ kind: "connection", status: "restart_failed" });
		expect(restartFailed).toContain('role="alert"');
		expect(restartFailed).toContain("Retry connection");
		expect(restartFailed).not.toContain(">Retry<");
	});

	test("发送被拒不提供重试，选择项目的操作只在有选择器时出现", () => {
		const markup = render({
			kind: "send",
			failure: { code: "session.workspace_required", retryable: false, action: "choose_project" },
		});

		expect(markup).toContain('role="alert"');
		expect(markup).not.toContain(">Retry<");
		expect(markup).not.toContain("Choose project");
	});

	test("没有提示时不渲染", () => {
		expect(render(undefined)).toBe("");
	});

	test("ChatColumn 只在输入框上方显示一个提示位，没有独立的连接/中断 banner", () => {
		const chat = {
			id: null,
			messages: [],
			runs: [],
			todos: undefined,
			artifacts: [],
			usage: EMPTY_DESKTOP_SESSION_USAGE,
			context: undefined,
			status: "ready",
			isLoading: false,
			notice: { kind: "connection", status: "restart_failed" },
			modelRef: "provider/model",
			controls: defaultDesktopSessionControls,
			configure: async () => {},
			sendMessage: async () => false,
			steerQueuedMessage: async () => false,
			stop: async () => {},
			navigate: async () => false,
			retry: async () => undefined,
			compact: async () => undefined,
			retryConnection: async () => {},
			resolvePermission: async () => {},
			dismissNotice: () => {},
		} satisfies Chat;
		const markup = renderToStaticMarkup(
			<IntlProvider locale="en" messages={enMessages}>
				<ChatColumn
					projects={[]}
					chat={chat}
					draft=""
					queue={[]}
					onDraftChange={() => {}}
					onEditQueuedMessage={() => {}}
					onRemoveQueuedMessage={() => {}}
					onReorderQueuedMessages={() => {}}
					selectedModelRef="provider/model"
					selectedControls={defaultDesktopSessionControls}
					providerLoading={false}
					providerError={false}
					projectBusy={false}
					projectLoading={false}
					projectLoadError={false}
					sidebarOpen
					macTitleBar={false}
					onOpenProviderSettings={() => {}}
					onSelectProviderModel={() => {}}
					onSelectControls={() => {}}
					onChooseProject={async () => {}}
					onRetryProjects={() => {}}
					onRenameSession={async () => {}}
					onArchiveSession={async () => {}}
					onDeleteSession={async () => {}}
				/>
			</IntlProvider>,
		);

		expect(markup.match(/data-slot="composer-notice"/g)).toHaveLength(1);
		expect(markup.match(/role="alert"/g)).toHaveLength(1);
		expect(markup.indexOf('data-slot="composer-notice"')).toBeLessThan(markup.indexOf('aria-label="Message"'));
	});
});
