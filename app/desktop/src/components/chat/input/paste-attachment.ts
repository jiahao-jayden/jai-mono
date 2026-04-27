export const PASTE_THRESHOLD = 100;

export interface PastedText {
	id: string;
	text: string;
}

export function combineWithPastedTexts(text: string, pasted: PastedText[]): string {
	if (pasted.length === 0) return text;
	const blocks = pasted
		.map((p, i) => `<pasted-text index="${i + 1}" chars="${p.text.length}">\n${p.text}\n</pasted-text>`)
		.join("\n\n");
	const trimmed = text.trim();
	return trimmed ? `${blocks}\n\n${trimmed}` : blocks;
}
