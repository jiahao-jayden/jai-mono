import type { Paragraph, PhrasingContent, Root, ThematicBreak } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

function preserveLineBreaks(children: readonly PhrasingContent[]): PhrasingContent[] {
	return children.flatMap((child) => {
		if (child.type !== "text" || !child.value.includes("\n")) return [child];

		return child.value.split(/\r?\n/).flatMap((line, index) => {
			const text: PhrasingContent = { type: "text", value: line };
			return index === 0 ? [text] : [{ type: "break" }, text];
		});
	});
}

export const remarkDisableSetextH2: Plugin<[], Root> = () => (tree, file) => {
	const source = String(file.value);

	visit(tree, "heading", (node, index, parent) => {
		const start = node.position?.start.offset;
		const end = node.position?.end.offset;
		if (node.depth !== 2 || index === undefined || !parent || start === undefined || end === undefined) return;

		const lastLine = source.slice(start, end).split(/\r?\n/).at(-1);
		if (!lastLine || !/^[\t ]*-+[\t ]*$/.test(lastLine)) return;

		const paragraph: Paragraph = {
			type: "paragraph",
			children: preserveLineBreaks(node.children),
		};
		const thematicBreak: ThematicBreak = { type: "thematicBreak" };
		parent.children.splice(index, 1, paragraph, thematicBreak);
		return index + 2;
	});
};
