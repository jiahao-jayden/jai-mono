import type { TextContent } from "@jayden/jai-ai";
import type { RawAttachment } from "../types.js";

export function handleUnsupported(attachment: RawAttachment): TextContent {
	return {
		type: "text",
		text: `[File: ${attachment.filename} — unsupported file type: ${attachment.mimeType}]`,
	};
}
