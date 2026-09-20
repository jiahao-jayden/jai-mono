import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup as renderToStaticMarkupBase } from "react-dom/server";
import { IntlProvider } from "react-intl";
import enMessages from "../src/i18n/compiled/en.json";
import { ChatMessage, MarkdownContent } from "../src/components/ui/chat-message";
import {
	createChatTokenStream,
	ensureChatLanguage,
	getChatHighlighter,
	highlightChatCode,
} from "../src/components/ui/chat-code-highlight";

function renderToStaticMarkup(node: React.ReactNode): string {
	return renderToStaticMarkupBase(createElement(IntlProvider, { locale: "en", messages: enMessages }, node));
}

describe("chat code highlight", () => {
	test("多次取 highlighter 得到同一实例", async () => {
		const first = await getChatHighlighter();
		const second = await getChatHighlighter();
		expect(first).toBe(second);
	});

	test("rust 与 ts 能出带色 token", async () => {
		expect(await ensureChatLanguage("rust")).toBe(true);
		expect(await ensureChatLanguage("ts")).toBe(true);
		const highlighter = await getChatHighlighter();
		const rust = highlighter.codeToTokens("fn main() { let x = 1; }", {
			lang: "rust",
			theme: "github-light",
		});
		const ts = highlighter.codeToTokens("const x: number = 1;", {
			lang: "ts",
			theme: "github-dark",
		});
		expect(rust.tokens.flat().some((token) => token.color)).toBe(true);
		expect(ts.tokens.flat().some((token) => token.color)).toBe(true);
	});

	test("未知语言返回失败，不抛错", async () => {
		expect(await ensureChatLanguage("not-a-real-lang-xyz")).toBe(false);
		expect(await ensureChatLanguage("")).toBe(false);
	});

	test("完成态 rust/go/java/py 有 GitHub 色且无 th-keyword", async () => {
		const samples = {
			rust: "fn main() { let x = 1; }",
			go: "func main() { x := 1 }",
			java: "class A { int x = 1; }",
			py: "def main():\n    x = 1",
		};
		for (const [language, source] of Object.entries(samples)) {
			const html = await highlightChatCode(source, language, "github-light");
			expect(html).toBeDefined();
			expect(html).toContain('class="shiki');
			expect(html).toContain("color:");
			expect(html).not.toContain("th-keyword");
		}
	});

	test("追加文本后 token 增加，不必等完成", async () => {
		const tokenizer = await createChatTokenStream("rust", "github-light");
		expect(tokenizer).toBeDefined();
		if (!tokenizer) throw new Error("expected tokenizer");
		await tokenizer.enqueue("fn ");
		const mid = tokenizer.tokensStable.length + tokenizer.tokensUnstable.length;
		expect(mid).toBeGreaterThan(0);
		await tokenizer.enqueue("main() { let x = 1; }\n");
		expect(tokenizer.tokensStable.length + tokenizer.tokensUnstable.length).toBeGreaterThan(mid);
	});

	test("Markdown 围栏仍走 CodeBlock chrome，用户气泡不走 Markdown", () => {
		const assistant = renderToStaticMarkup(
			createElement(MarkdownContent, { content: "```rust\nfn main() {}\n```" }),
		);
		expect(assistant).toContain('data-streamdown="code-block"');
		expect(assistant).not.toContain("th-keyword");
		const user = renderToStaticMarkup(createElement(ChatMessage, { from: "user" }, "```rust\nfn main() {}\n```"));
		expect(user).not.toContain('data-streamdown="code-block"');
		expect(user).toContain("```rust");
	});
});
