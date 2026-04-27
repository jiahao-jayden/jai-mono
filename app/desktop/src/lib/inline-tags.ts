export interface InlineTag {
	name: string;
	attrs: Record<string, string>;
	content: string;
}

export type InlineSegment = { kind: "text"; text: string } | { kind: "tag"; tag: InlineTag };

/**
 * Split `input` into a sequence of plain-text and tag segments. Only tags
 * whose name is present in `knownTags` are recognized; everything else
 * (including malformed tags) is preserved as plain text.
 *
 * The matcher is intentionally simple — it expects well-formed
 * `<name [attrs]>content</name>` blocks with no nesting of the same tag.
 * Attribute values must be double-quoted.
 */
export function parseInlineTags(input: string, knownTags: ReadonlySet<string>): InlineSegment[] {
	if (knownTags.size === 0 || input.length === 0) {
		return input ? [{ kind: "text", text: input }] : [];
	}

	const namePattern = Array.from(knownTags).map(escapeRegex).join("|");
	const re = new RegExp(`<(${namePattern})(\\s[^>]*)?>([\\s\\S]*?)</\\1>`, "g");

	const segments: InlineSegment[] = [];
	let cursor = 0;
	let match: RegExpExecArray | null = re.exec(input);
	while (match !== null) {
		if (match.index > cursor) {
			segments.push({ kind: "text", text: input.slice(cursor, match.index) });
		}
		const [, name, attrsRaw, content] = match;
		segments.push({
			kind: "tag",
			tag: {
				name,
				attrs: parseAttrs(attrsRaw ?? ""),
				content,
			},
		});
		cursor = match.index + match[0].length;
		match = re.exec(input);
	}
	if (cursor < input.length) {
		segments.push({ kind: "text", text: input.slice(cursor) });
	}
	return segments;
}

function parseAttrs(raw: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const re = /(\w[\w-]*)="([^"]*)"/g;
	let match: RegExpExecArray | null = re.exec(raw);
	while (match !== null) {
		attrs[match[1]] = match[2];
		match = re.exec(raw);
	}
	return attrs;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
