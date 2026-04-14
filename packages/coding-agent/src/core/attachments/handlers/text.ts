import type { TextContent } from "@jayden/jai-ai";
import { ATTACHMENT_LIMITS, type RawAttachment } from "../types.js";

export function handleText(attachment: RawAttachment): TextContent {
	const buf = Buffer.from(attachment.data, "base64");
	let text = buf.toString("utf-8");

	let truncated = false;
	if (text.length > ATTACHMENT_LIMITS.MAX_TEXT_CHARS) {
		const lines = text.split("\n");
		let charCount = 0;
		let lineIndex = 0;
		for (; lineIndex < lines.length; lineIndex++) {
			charCount += lines[lineIndex].length + 1;
			if (charCount >= ATTACHMENT_LIMITS.MAX_TEXT_CHARS) break;
		}
		text = lines.slice(0, lineIndex).join("\n");
		text += `\n\n[Truncated at line ${lineIndex} of ${lines.length}]`;
		truncated = true;
	}

	const header = truncated ? `[File: ${attachment.filename} (truncated)]` : `[File: ${attachment.filename}]`;

	return {
		type: "text",
		text: `${header}\n<file_content>\n${text}\n</file_content>`,
	};
}
