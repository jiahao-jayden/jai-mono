import { ShikiStreamTokenizer } from "@shikijs/stream";
import {
	bundledLanguages,
	bundledLanguagesAlias,
	createHighlighter,
	createJavaScriptRegexEngine,
	type BundledLanguage,
	type Highlighter,
} from "shiki";

export type ChatHighlighter = Highlighter;
export type ChatHighlightTheme = "github-light" | "github-dark";

const chatThemes = ["github-light", "github-dark"] as const;

let highlighterPromise: Promise<ChatHighlighter> | undefined;

export function getChatHighlighter(): Promise<ChatHighlighter> {
	highlighterPromise ??= createHighlighter({
		themes: [...chatThemes],
		langs: ["text"],
		engine: createJavaScriptRegexEngine(),
	});
	return highlighterPromise;
}

export async function ensureChatLanguage(language: string): Promise<boolean> {
	const lang = language.trim().toLowerCase();
	if (!lang || (!(lang in bundledLanguages) && !(lang in bundledLanguagesAlias))) return false;
	const highlighter = await getChatHighlighter();
	if (highlighter.getLoadedLanguages().includes(lang)) return true;
	try {
		await highlighter.loadLanguage(lang as BundledLanguage);
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
	if (!(await ensureChatLanguage(language))) return undefined;
	const highlighter = await getChatHighlighter();
	try {
		return highlighter.codeToHtml(value, {
			lang: language as BundledLanguage,
			theme,
		});
	} catch {
		return undefined;
	}
}

export async function createChatTokenStream(
	language: string,
	theme: ChatHighlightTheme,
): Promise<ShikiStreamTokenizer | undefined> {
	if (!(await ensureChatLanguage(language))) return undefined;
	const highlighter = await getChatHighlighter();
	return new ShikiStreamTokenizer({ highlighter, lang: language, theme });
}
