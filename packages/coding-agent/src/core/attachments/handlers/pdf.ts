import type { FileContent, ModelCapabilities, TextContent } from "@jayden/jai-ai";
import { PDFParse } from "pdf-parse";
import { ATTACHMENT_LIMITS, type RawAttachment } from "../types.js";

export async function handlePdf(
	attachment: RawAttachment,
	capabilities: ModelCapabilities,
): Promise<FileContent | TextContent> {
	if (capabilities.input.pdf && attachment.size <= ATTACHMENT_LIMITS.PDF_MAX_SIZE) {
		return {
			type: "file",
			data: attachment.data,
			mimeType: "application/pdf",
			filename: attachment.filename,
		};
	}

	const buf = Buffer.from(attachment.data, "base64");
	try {
		const pdf = new PDFParse({ data: new Uint8Array(buf) });
		const textResult = await pdf.getText();
		const totalPages = textResult.total;
		let text = textResult.text;

		if (text.length > ATTACHMENT_LIMITS.MAX_TEXT_CHARS) {
			text = text.slice(0, ATTACHMENT_LIMITS.MAX_TEXT_CHARS);
			const truncationNote =
				totalPages > ATTACHMENT_LIMITS.PDF_MAX_PAGES
					? `[Truncated: showing partial content from ${totalPages}-page PDF]`
					: `[Truncated at ${ATTACHMENT_LIMITS.MAX_TEXT_CHARS} characters]`;
			text += `\n\n${truncationNote}`;
		}

		await pdf.destroy();

		return {
			type: "text",
			text: `[PDF: ${attachment.filename} (${totalPages} pages)]\n<pdf_content>\n${text}\n</pdf_content>`,
		};
	} catch {
		return {
			type: "text",
			text: `[PDF: ${attachment.filename} — failed to extract text]`,
		};
	}
}
