import { describe, expect, test } from "bun:test";
import { shouldOpenExternalUrl } from "../electron/external-url";

const app = "http://localhost:5173/";

describe("shouldOpenExternalUrl", () => {
	test("另一个端口的预览地址交给系统浏览器", () => {
		expect(shouldOpenExternalUrl(app, "http://localhost:4173/")).toBe(true);
	});

	test("应用自己的页面留在窗口里", () => {
		expect(shouldOpenExternalUrl(app, "http://localhost:5173/index.html")).toBe(false);
	});

	test("打包后的 file 文档刷新留在窗口里，其他文件交给外部打开", () => {
		const document = "file:///Applications/JAI.app/Contents/Resources/renderer/main/index.html";
		expect(shouldOpenExternalUrl(document, document)).toBe(false);
		expect(shouldOpenExternalUrl(document, "file:///tmp/design/index.html")).toBe(true);
		expect(shouldOpenExternalUrl(document, "https://example.com/design")).toBe(true);
	});
});
