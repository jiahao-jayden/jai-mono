import { describe, expect, test } from "bun:test";
import { projectContextMenuItems } from "../src/components/shell/project-actions";
import { sessionContextMenuItems } from "../src/components/shell/session-actions";
import { nativeMenuAnchor, withNativeMenuIcons } from "../src/lib/native-menu-icons";

describe("projectContextMenuItems", () => {
	test("可用项目提供 Finder 打开和复制路径", () => {
		expect(
			projectContextMenuItems(
				{ available: true },
				{ reveal: "Open in Finder", copyPath: "Copy path", relink: "Relink" },
			),
		).toEqual([
			{ id: "reveal", label: "Open in Finder", icon: "folder-open" },
			{ id: "copy-path", label: "Copy path", icon: "copy" },
		]);
	});

	test("不可用项目提供复制路径和重新关联", () => {
		expect(
			projectContextMenuItems(
				{ available: false },
				{ reveal: "Open in Finder", copyPath: "Copy path", relink: "Relink" },
			),
		).toEqual([
			{ id: "copy-path", label: "Copy path", icon: "copy" },
			{ id: "relink", label: "Relink", icon: "link" },
		]);
	});
});

describe("sessionContextMenuItems", () => {
	const labels = {
		rename: "Rename",
		copyId: "Copy session ID",
		archive: "Archive",
		delete: "Delete",
	};

	test("运行中的会话隐藏归档", () => {
		expect(sessionContextMenuItems({ running: true, canArchive: true, labels })).toEqual([
			{ id: "rename", label: "Rename", icon: "pencil" },
			{ id: "copy-id", label: "Copy session ID", icon: "copy" },
			{ id: "delete", label: "Delete", icon: "trash", destructive: true, separatorBefore: true },
		]);
	});

	test("空闲会话保留归档", () => {
		expect(sessionContextMenuItems({ running: false, canArchive: true, labels })).toEqual([
			{ id: "rename", label: "Rename", icon: "pencil" },
			{ id: "copy-id", label: "Copy session ID", icon: "copy" },
			{ id: "archive", label: "Archive", icon: "archive", separatorBefore: true },
			{ id: "delete", label: "Delete", icon: "trash", destructive: true, separatorBefore: true },
		]);
	});
});

describe("nativeMenuAnchor", () => {
	test("右键菜单下移，避免松手点到第一项", () => {
		expect(nativeMenuAnchor({ clientX: 10, clientY: 20 })).toEqual({ x: 10, y: 36 });
	});
});

describe("withNativeMenuIcons", () => {
	test("不把 icon 名送过 RPC，失败时仍保留条目", async () => {
		const items = await withNativeMenuIcons([{ id: "rename", label: "Rename", icon: "pencil" }]);
		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({ id: "rename", label: "Rename" });
		expect(items[0]).not.toHaveProperty("icon");
		if (items[0]?.iconDataUrl) {
			expect(items[0].iconDataUrl.startsWith("data:image/png;base64,")).toBe(true);
		}
	});
});
