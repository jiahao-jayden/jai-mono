import type { FileContent, ImageContent, ModelCapabilities, TextContent } from "@jayden/jai-ai";
import { handleImage } from "./handlers/image.js";
import { handlePdf } from "./handlers/pdf.js";
import { handleText } from "./handlers/text.js";
import { handleUnsupported } from "./handlers/unsupported.js";
import { ATTACHMENT_LIMITS, isTextFile, type RawAttachment } from "./types.js";

export type ProcessedContent = TextContent | ImageContent | FileContent;

export async function processAttachments(
	attachments: RawAttachment[],
	capabilities: ModelCapabilities,
): Promise<ProcessedContent[]> {
	const results: ProcessedContent[] = [];

	for (const att of attachments) {
		if (att.size > ATTACHMENT_LIMITS.MAX_FILE_SIZE) {
			results.push({
				type: "text",
				text: `[File: ${att.filename} — exceeds ${ATTACHMENT_LIMITS.MAX_FILE_SIZE / 1024 / 1024}MB size limit]`,
			});
			continue;
		}

		results.push(await processOne(att, capabilities));
	}

	return results;
}

async function processOne(attachment: RawAttachment, capabilities: ModelCapabilities): Promise<ProcessedContent> {
	const { mimeType, filename } = attachment;

	if (mimeType.startsWith("image/")) {
		return handleImage(attachment, capabilities);
	}

	if (mimeType === "application/pdf") {
		return handlePdf(attachment, capabilities);
	}

	if (isTextFile(mimeType, filename)) {
		return handleText(attachment);
	}

	// Office documents — not yet supported
	if (
		mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
		mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
		mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
		mimeType === "application/msword" ||
		mimeType === "application/vnd.ms-excel" ||
		mimeType === "application/vnd.ms-powerpoint"
	) {
		return {
			type: "text",
			text: `[Document: ${filename} — Office format not yet supported]`,
		};
	}

	return handleUnsupported(attachment);
}
