import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import remarkParse from "remark-parse";
import { Streamdown } from "streamdown";
import { unified } from "unified";
import { remarkDisableSetextH2 } from "../src/lib/remark-disable-setext-h2";

function parse(markdown: string) {
	const processor = unified().use(remarkParse).use(remarkDisableSetextH2);
	return processor.runSync(processor.parse(markdown), markdown);
}

describe("remarkDisableSetextH2", () => {
	test("将 Setext H2 还原为普通段落和分割线", () => {
		const tree = parse("✅ All agents reported back!\n├─ Reddit\n└─ GitHub\n---");

		expect(tree.children.map((node) => node.type)).toEqual(["paragraph", "thematicBreak"]);
		expect(tree.children[0]).toMatchObject({
			children: [{ type: "text" }, { type: "break" }, { type: "text" }, { type: "break" }, { type: "text" }],
		});
	});

	test("保留 ATX H2", () => {
		const tree = parse("## 正常二级标题");

		expect(tree.children.map((node) => node.type)).toEqual(["heading"]);
	});

	test("Streamdown 不再把 footer 渲染为 H2", () => {
		const html = renderToStaticMarkup(
			createElement(Streamdown, {
				children: "✅ All agents reported back!\n├─ Reddit\n└─ GitHub\n---",
				mode: "static",
				remarkPlugins: [remarkDisableSetextH2],
			}),
		);

		expect(html).not.toContain("<h2");
		expect(html.match(/<br\/>/g)).toHaveLength(2);
		expect(html).toContain("<hr");
	});
});
