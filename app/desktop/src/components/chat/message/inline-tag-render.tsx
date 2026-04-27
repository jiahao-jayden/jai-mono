import { Fragment, type ReactNode } from "react";
import { type InlineTag, parseInlineTags } from "@/lib/inline-tags";

type TagRenderer = (tag: InlineTag, key: string) => ReactNode;

/**
 * Tags listed here are parsed and silently stripped from the rendered
 * output. Use this when the model needs to see the tag in context but the
 * UI should not show it.
 */
const STRIP_TAGS: ReadonlySet<string> = new Set(["pasted-text"]);

/**
 * Tags listed here are parsed and rendered via the registered React
 * component. To start rendering a stripped tag visually, move its name
 * out of STRIP_TAGS and add an entry here.
 */
const TAG_RENDERERS: Record<string, TagRenderer> = {};

const KNOWN_TAGS: ReadonlySet<string> = new Set([...STRIP_TAGS, ...Object.keys(TAG_RENDERERS)]);

/**
 * Transforms a raw text body containing well-known XML-like inline tags
 * into React nodes. Recognized tags are either silently stripped or rendered
 * via their registered renderer; unrecognized tag-like fragments fall through
 * as plain text.
 */
export function renderTextWithInlineTags(text: string): ReactNode {
	const segments = parseInlineTags(text, KNOWN_TAGS);
	if (segments.length === 0) return null;

	const nodes: ReactNode[] = [];
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		const key = `seg-${i}`;
		if (seg.kind === "text") {
			if (seg.text.length === 0) continue;
			nodes.push(<Fragment key={key}>{seg.text}</Fragment>);
			continue;
		}
		const renderer = TAG_RENDERERS[seg.tag.name];
		if (!renderer) continue;
		nodes.push(renderer(seg.tag, key));
	}

	if (nodes.length === 0) return null;
	if (nodes.length === 1 && segments.length === 1 && segments[0].kind === "text") {
		return segments[0].text;
	}
	return nodes;
}
