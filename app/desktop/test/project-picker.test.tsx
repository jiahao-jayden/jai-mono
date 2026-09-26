import { describe, expect, test } from "bun:test";
import { IntlProvider } from "react-intl";
import { renderToStaticMarkup as renderToStaticMarkupBase } from "react-dom/server";
import type { ReactNode } from "react";
import type { DesktopProject } from "../shared/desktop-rpc";
import { defaultDesktopSessionControls } from "../shared/session-controls";
import enMessages from "../src/i18n/compiled/en.json";
import { ChatComposer } from "../src/components/shell/chat/chat-composer";
import { ProjectPicker } from "../src/components/shell/chat/project-picker";

function renderToStaticMarkup(node: ReactNode): string {
	return renderToStaticMarkupBase(<IntlProvider locale="en" messages={enMessages}>{node}</IntlProvider>);
}

const project: DesktopProject = {
	id: "project-1",
	displayName: "jai-mono",
	path: "/code/jai-mono",
	canonicalPath: "/code/jai-mono",
	createdAt: 1,
	updatedAt: 1,
	expanded: false,
	available: true,
};

describe("ProjectPicker", () => {
	test("默认 workspace Chat 没有 Project 时允许发送消息", () => {
		const markup = renderToStaticMarkup(
			<ChatComposer
				value="Inspect this"
				onValueChange={() => {}}
				onSend={async () => false}
				onStop={async () => {}}
				status="ready"
				disabled={false}
				queue={[]}
				onEditQueuedMessage={() => {}}
				onRemoveQueuedMessage={() => {}}
				onReorderQueuedMessages={() => {}}
				onSteerQueuedMessage={async () => false}
				projects={[]}
				projectBusy={false}
				projectLoading={false}
				projectLoadError={false}
				onChooseProject={async () => {}}
				onRetryProjects={() => {}}
				selectedModelRef="provider/model"
				selectedControls={defaultDesktopSessionControls}
				providerLoading={false}
				providerError={false}
				onOpenProviderSettings={() => {}}
				onSelectProviderModel={() => {}}
				onSelectControls={() => {}}
			/>,
		);

		expect(markup).toContain('placeholder="Write a message…"');
		expect(markup).toContain('aria-label="Send message"');
		expect(markup).not.toContain('placeholder="Write a message…" disabled');
		expect(markup).toContain("Project");
	});

	test("已选但不可用的 Project 继续禁用 Composer 并提示重新关联", () => {
		const markup = renderToStaticMarkup(
			<ChatComposer
				value="Inspect this"
				onValueChange={() => {}}
				onSend={async () => false}
				onStop={async () => {}}
				status="ready"
				disabled={false}
				queue={[]}
				onEditQueuedMessage={() => {}}
				onRemoveQueuedMessage={() => {}}
				onReorderQueuedMessages={() => {}}
				onSteerQueuedMessage={async () => false}
				project={{ ...project, available: false }}
				projects={[{ ...project, available: false }]}
				projectBusy={false}
				projectLoading={false}
				projectLoadError={false}
				onChooseProject={async () => {}}
				onRetryProjects={() => {}}
				selectedModelRef="provider/model"
				selectedControls={defaultDesktopSessionControls}
				providerLoading={false}
				providerError={false}
				onOpenProviderSettings={() => {}}
				onSelectProviderModel={() => {}}
				onSelectControls={() => {}}
			/>,
		);

		expect(markup).toContain("Choose an accessible project before sending a message.");
		expect(markup).toContain('placeholder="Choose an accessible project before sending a message." disabled');
		expect(markup).toContain("jai-mono (Relink)");
	});

	test("停止请求提交后显示 loading 状态并阻止重复点击", () => {
		const markup = renderToStaticMarkup(
			<ChatComposer
				value=""
				onValueChange={() => {}}
				onSend={async () => false}
				onStop={async () => {}}
				status="stopping"
				disabled={false}
				queue={[]}
				onEditQueuedMessage={() => {}}
				onRemoveQueuedMessage={() => {}}
				onReorderQueuedMessages={() => {}}
				onSteerQueuedMessage={async () => false}
				projects={[]}
				projectBusy={false}
				projectLoading={false}
				projectLoadError={false}
				onChooseProject={async () => {}}
				onRetryProjects={() => {}}
				selectedModelRef="provider/model"
				selectedControls={defaultDesktopSessionControls}
				providerLoading={false}
				providerError={false}
				onOpenProviderSettings={() => {}}
				onSelectProviderModel={() => {}}
				onSelectControls={() => {}}
			/>,
		);

		expect(markup).toContain('aria-label="Stop response"');
		expect(markup).toContain('disabled=""');
		expect(markup).toContain("spinner-move");
	});

	test("当前 Project 作为可访问的菜单触发器显示", () => {
		const markup = renderToStaticMarkup(
			<ProjectPicker
				project={project}
				projects={[project]}
				disabled={false}
				busy={false}
				loading={false}
				loadError={false}
				onChoose={async () => {}}
				onRetry={() => {}}
			/>,
		);

		expect(markup).toContain('aria-label="Project: jai-mono"');
		expect(markup).toContain("jai-mono");
		expect(markup).not.toContain(' disabled=""');
	});

	test("不可用目录明确提示 Relink 并阻止静默执行", () => {
		const markup = renderToStaticMarkup(
			<ProjectPicker
				project={{ ...project, available: false }}
				projects={[{ ...project, available: false }]}
				disabled={false}
				busy={false}
				loading={false}
				loadError={false}
				onChoose={async () => {}}
				onRetry={() => {}}
			/>,
		);

		expect(markup).toContain("jai-mono (Relink)");
		expect(markup).toContain("This folder is unavailable");
	});

	test("加载失败不会伪装成空 Project", () => {
		const markup = renderToStaticMarkup(
			<ProjectPicker
				projects={[]}
				disabled={false}
				busy={false}
				loading={false}
				loadError
				onChoose={async () => {}}
				onRetry={() => {}}
			/>,
		);

		expect(markup).toContain("Projects unavailable");
		expect(markup).not.toContain("Choose project");
	});
});
