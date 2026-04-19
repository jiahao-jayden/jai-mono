import { parse } from "yaml";

export type ParsedFrontmatter<T extends Record<string, unknown>> = {
	frontmatter: T;
	body: string;
};

const normalize = (s: string): string => s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

export function parseFrontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
	content: string,
): ParsedFrontmatter<T> {
	const normalized = normalize(content);
	if (!normalized.startsWith("---")) {
		return { frontmatter: {} as T, body: normalized };
	}
	const end = normalized.indexOf("\n---", 3);
	if (end === -1) {
		return { frontmatter: {} as T, body: normalized };
	}
	const yamlString = normalized.slice(4, end);
	const body = normalized.slice(end + 4).trim();
	const parsed = (parse(yamlString) ?? {}) as T;
	return { frontmatter: parsed, body };
}
