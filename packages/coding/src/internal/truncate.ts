import type { TruncationDetails } from "../tools/types";

export const DEFAULT_MAX_LINES = 2_000;
export const DEFAULT_MAX_BYTES = 50 * 1024;
export const DEFAULT_MAX_LINE_LENGTH = 2_000;

export interface TruncateOptions {
	direction?: "head" | "tail";
	maxLines?: number;
	maxBytes?: number;
	maxLineLength?: number;
}

export interface TruncatedText {
	content: string;
	details?: TruncationDetails;
	linesTruncated: boolean;
}

function truncateLine(line: string, maxLength: number): { text: string; truncated: boolean } {
	if (line.length <= maxLength) return { text: line, truncated: false };
	return {
		text: `${line.slice(0, maxLength)}… [line truncated]`,
		truncated: true,
	};
}

export function truncateText(text: string, options: TruncateOptions = {}): TruncatedText {
	const direction = options.direction ?? "head";
	const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
	const sourceLines = text.split("\n");
	let linesTruncated = false;
	const normalizedLines = sourceLines.map((line) => {
		const result = truncateLine(line, maxLineLength);
		linesTruncated ||= result.truncated;
		return result.text;
	});
	const candidates = direction === "head" ? normalizedLines : [...normalizedLines].reverse();
	const selected: string[] = [];
	let outputBytes = 0;

	for (const line of candidates) {
		if (selected.length >= maxLines) break;
		const lineBytes = Buffer.byteLength(line, "utf8");
		const separatorBytes = selected.length === 0 ? 0 : 1;
		if (outputBytes + separatorBytes + lineBytes > maxBytes) break;
		selected.push(line);
		outputBytes += separatorBytes + lineBytes;
	}

	if (direction === "tail") selected.reverse();

	const content = selected.join("\n");
	const truncated = selected.length < normalizedLines.length || linesTruncated;
	if (!truncated) return { content, linesTruncated };

	return {
		content,
		linesTruncated,
		details: {
			truncated: true,
			direction,
			totalLines: sourceLines.length,
			outputLines: selected.length,
			outputBytes,
			maxLines,
			maxBytes,
		},
	};
}
