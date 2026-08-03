import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DesktopWorkspace } from "../shared/desktop-rpc";
import { WorkspacePicker } from "../src/components/shell/chat/workspace-picker";

const workspace: DesktopWorkspace = {
	id: "workspace-1",
	displayName: "jai-mono",
	path: "/code/jai-mono",
	canonicalPath: "/code/jai-mono",
	createdAt: 1,
	updatedAt: 1,
	available: true,
};

describe("WorkspacePicker", () => {
	test("当前 Workspace 作为可访问的菜单触发器显示", () => {
		const markup = renderToStaticMarkup(
			<WorkspacePicker
				workspace={workspace}
				workspaces={[workspace]}
				disabled={false}
				busy={false}
				loading={false}
				loadError={false}
				onChoose={async () => {}}
				onAdd={async () => {}}
				onRetry={() => {}}
			/>,
		);

		expect(markup).toContain('aria-label="Workspace: jai-mono"');
		expect(markup).toContain("jai-mono");
		expect(markup).not.toContain(' disabled=""');
	});

	test("不可用目录明确提示 Relink 并阻止静默执行", () => {
		const markup = renderToStaticMarkup(
			<WorkspacePicker
				workspace={{ ...workspace, available: false }}
				workspaces={[{ ...workspace, available: false }]}
				disabled={false}
				busy={false}
				loading={false}
				loadError={false}
				onChoose={async () => {}}
				onAdd={async () => {}}
				onRetry={() => {}}
			/>,
		);

		expect(markup).toContain("jai-mono (Relink)");
		expect(markup).toContain("This folder is unavailable");
	});

	test("加载失败不会伪装成空 Workspace", () => {
		const markup = renderToStaticMarkup(
			<WorkspacePicker
				workspaces={[]}
				disabled={false}
				busy={false}
				loading={false}
				loadError
				onChoose={async () => {}}
				onAdd={async () => {}}
				onRetry={() => {}}
			/>,
		);

		expect(markup).toContain("Workspaces unavailable");
		expect(markup).not.toContain("Choose workspace");
	});
});
