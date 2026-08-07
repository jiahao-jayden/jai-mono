import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("../src/components/ui/tabs", () => {
	const Tab = ({
		children,
		indicatorClassName: _indicatorClassName,
		...props
	}: {
		children: React.ReactNode;
		indicatorClassName?: string;
		[key: string]: unknown;
	}) => <div {...props}>{children}</div>;
	const TabPanel = ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
		<div {...props}>{children}</div>
	);

	return {
		Tabs: Tab,
		TabsList: Tab,
		TabItem: ({ label, icon: _icon, ...props }: { label: string; icon?: unknown; [key: string]: unknown }) => (
			<button {...props}>{label}</button>
		),
		TabPanel,
	};
});

const { WorkspacePanel } = await import("../src/components/shell/workspace-panel");

describe("WorkspacePanel", () => {
	test("提供编辑器式 Open file 和 Context tabs，并保持文件预览的诚实空状态", () => {
		const markup = renderToStaticMarkup(
			<WorkspacePanel
				status="idle"
				project={{
					id: "project-1",
					displayName: "Panda Work",
					path: "/tmp/panda-work",
					canonicalPath: "/tmp/panda-work",
					createdAt: 1,
					updatedAt: 1,
				}}
				todos={{
					version: 1,
					updatedAt: 1,
					items: [{ id: "inspect", content: "Inspect files", status: "completed" }],
				}}
			/>,
		);

		expect(markup).toContain('aria-label="Workspace views"');
		expect(markup).toContain("Open file");
		expect(markup).toContain("Context");
		expect(markup).toContain('aria-label="Open file tab"');
		expect(markup).toContain("Open a file");
		expect(markup).toContain("Select a file to preview it here.");
		expect(markup).toContain("Panda Work");
		expect(markup).toContain("/tmp/panda-work");
	});
});
