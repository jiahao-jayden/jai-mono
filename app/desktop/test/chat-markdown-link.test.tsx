import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownContent } from "../src/components/ui/chat-message";

describe("MarkdownContent links", () => {
	test("正文链接在系统浏览器打开", () => {
		const markup = renderToStaticMarkup(
			<MarkdownContent content={"[查看设计稿](http://localhost:4173/)"} />,
		);
		expect(markup).toContain('href="http://localhost:4173/"');
		expect(markup).toContain('target="_blank"');
		expect(markup).toContain('rel="noopener noreferrer"');
	});
});
