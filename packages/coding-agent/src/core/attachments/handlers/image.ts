import type { ImageContent, ModelCapabilities, TextContent } from "@jayden/jai-ai";
import sharp from "sharp";
import { ATTACHMENT_LIMITS, type RawAttachment } from "../types.js";

const QUALITY_STEPS = [85, 70, 55, 40];

export async function handleImage(
	attachment: RawAttachment,
	capabilities: ModelCapabilities,
): Promise<ImageContent | TextContent> {
	if (!capabilities.input.image) {
		return {
			type: "text",
			text: `[Image: ${attachment.filename} — model does not support vision input]`,
		};
	}

	const buf = Buffer.from(attachment.data, "base64");

	let pipeline = sharp(buf);
	const metadata = await pipeline.metadata();

	const maxDim = ATTACHMENT_LIMITS.IMAGE_MAX_DIMENSION;
	if ((metadata.width && metadata.width > maxDim) || (metadata.height && metadata.height > maxDim)) {
		pipeline = pipeline.resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true });
	}

	// Try PNG first for small images, then progressive JPEG quality reduction
	let result = await pipeline.png().toBuffer();
	if (result.length <= ATTACHMENT_LIMITS.IMAGE_MAX_BYTES) {
		return {
			type: "image",
			data: result.toString("base64"),
			mimeType: "image/png",
		};
	}

	for (const quality of QUALITY_STEPS) {
		result = await pipeline.jpeg({ quality }).toBuffer();
		if (result.length <= ATTACHMENT_LIMITS.IMAGE_MAX_BYTES) {
			return {
				type: "image",
				data: result.toString("base64"),
				mimeType: "image/jpeg",
			};
		}
	}

	// Further reduce dimensions if still too large
	const halfDim = Math.round(maxDim / 2);
	pipeline = sharp(buf).resize(halfDim, halfDim, { fit: "inside", withoutEnlargement: true });
	result = await pipeline.jpeg({ quality: 50 }).toBuffer();
	if (result.length <= ATTACHMENT_LIMITS.IMAGE_MAX_BYTES) {
		return {
			type: "image",
			data: result.toString("base64"),
			mimeType: "image/jpeg",
		};
	}

	return {
		type: "text",
		text: `[Image: ${attachment.filename} — too large to process even after compression (${Math.round(attachment.size / 1024)}KB)]`,
	};
}
