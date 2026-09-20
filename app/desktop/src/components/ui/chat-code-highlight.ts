import { ShikiStreamTokenizer } from "@shikijs/stream";
import { createBundledHighlighter } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export type ChatHighlightTheme = "github-light" | "github-dark";

/** Vite only emits these grammar chunks. Unknown fences stay plain text. */
const chatLanguages = {
	c: () => import("@shikijs/langs/c"),
	css: () => import("@shikijs/langs/css"),
	csharp: () => import("@shikijs/langs/csharp"),
	diff: () => import("@shikijs/langs/diff"),
	dockerfile: () => import("@shikijs/langs/dockerfile"),
	go: () => import("@shikijs/langs/go"),
	graphql: () => import("@shikijs/langs/graphql"),
	html: () => import("@shikijs/langs/html"),
	java: () => import("@shikijs/langs/java"),
	javascript: () => import("@shikijs/langs/javascript"),
	json: () => import("@shikijs/langs/json"),
	jsonc: () => import("@shikijs/langs/jsonc"),
	jsx: () => import("@shikijs/langs/jsx"),
	markdown: () => import("@shikijs/langs/markdown"),
	php: () => import("@shikijs/langs/php"),
	python: () => import("@shikijs/langs/python"),
	ruby: () => import("@shikijs/langs/ruby"),
	rust: () => import("@shikijs/langs/rust"),
	scss: () => import("@shikijs/langs/scss"),
	shellscript: () => import("@shikijs/langs/shellscript"),
	sql: () => import("@shikijs/langs/sql"),
	toml: () => import("@shikijs/langs/toml"),
	tsx: () => import("@shikijs/langs/tsx"),
	typescript: () => import("@shikijs/langs/typescript"),
	vue: () => import("@shikijs/langs/vue"),
	yaml: () => import("@shikijs/langs/yaml"),
} as const;

const chatLanguageAliases = {
	bash: "shellscript",
	"c#": "csharp",
	cs: "csharp",
	docker: "dockerfile",
	gql: "graphql",
	js: "javascript",
	md: "markdown",
	py: "python",
	rb: "ruby",
	rs: "rust",
	sh: "shellscript",
	shell: "shellscript",
	ts: "typescript",
	yml: "yaml",
	zsh: "shellscript",
} as const satisfies Record<string, keyof typeof chatLanguages>;

const chatThemes = {
	"github-dark": () => import("@shikijs/themes/github-dark"),
	"github-light": () => import("@shikijs/themes/github-light"),
} as const;

type ChatLanguage = keyof typeof chatLanguages;

const createHighlighter = createBundledHighlighter({
	langs: chatLanguages,
	themes: chatThemes,
	engine: () => createJavaScriptRegexEngine(),
});

export type ChatHighlighter = Awaited<ReturnType<typeof createHighlighter>>;

let highlighterPromise: Promise<ChatHighlighter> | undefined;

function resolveChatLanguage(language: string): ChatLanguage | undefined {
	const lang = language.trim().toLowerCase();
	if (lang in chatLanguages) return lang as ChatLanguage;
	if (lang in chatLanguageAliases) return chatLanguageAliases[lang as keyof typeof chatLanguageAliases];
	return undefined;
}

export function getChatHighlighter(): Promise<ChatHighlighter> {
	highlighterPromise ??= createHighlighter({
		langs: [],
		themes: ["github-light", "github-dark"],
	});
	return highlighterPromise;
}

export async function ensureChatLanguage(language: string): Promise<boolean> {
	const lang = resolveChatLanguage(language);
	if (!lang) return false;
	const highlighter = await getChatHighlighter();
	if (highlighter.getLoadedLanguages().includes(lang)) return true;
	try {
		await highlighter.loadLanguage(lang);
		return true;
	} catch {
		return false;
	}
}

export async function highlightChatCode(
	value: string,
	language: string,
	theme: ChatHighlightTheme,
): Promise<string | undefined> {
	const lang = resolveChatLanguage(language);
	if (!lang || !(await ensureChatLanguage(lang))) return undefined;
	const highlighter = await getChatHighlighter();
	try {
		return highlighter.codeToHtml(value, { lang, theme });
	} catch {
		return undefined;
	}
}

export async function createChatTokenStream(
	language: string,
	theme: ChatHighlightTheme,
): Promise<ShikiStreamTokenizer | undefined> {
	const lang = resolveChatLanguage(language);
	if (!lang || !(await ensureChatLanguage(lang))) return undefined;
	const highlighter = await getChatHighlighter();
	return new ShikiStreamTokenizer({ highlighter, lang, theme });
}
