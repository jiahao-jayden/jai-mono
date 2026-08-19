import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import type { CodingAttachment } from "@jai/coding-agent";
import { TaggedError } from "better-result";
import type { DesktopAttachmentRegistrationInput, DesktopMessageAttachment } from "../shared/desktop-rpc";

class AttachmentRegistrationFailed extends TaggedError("desktop_attachment.registration_failed")<{
	readonly cause?: unknown;
	readonly message: string;
}> {}

const attachmentError = (init: { readonly cause?: unknown; readonly message: string }) =>
	new AttachmentRegistrationFailed(init);

/**
 * Owns the lifetime of files staged for the next prompt: registered when the
 * user attaches one, resolved when the prompt is sent, released otherwise.
 */
export interface AttachmentRegistry {
	register(input: DesktopAttachmentRegistrationInput): Promise<DesktopMessageAttachment>;
	release(ids: readonly string[]): void;
	resolve(id: string): CodingAttachment;
	clear(): void;
}

export function createAttachmentRegistry(): AttachmentRegistry {
	const records = new Map<string, CodingAttachment>();
	return {
		async register(input) {
			try {
				const fileStats = await stat(input.sourcePath);
				if (!fileStats.isFile()) throw new Error("Attachment path is not a file");
				if (fileStats.size !== input.size) throw new Error("Attachment size changed before it was sent");
				const id = `attachment-${randomUUID()}`;
				records.set(id, {
					id,
					filename: input.filename,
					mimeType: input.mimeType,
					size: input.size,
					sourcePath: input.sourcePath,
				});
				return {
					id,
					filename: input.filename,
					mimeType: input.mimeType,
					size: input.size,
				} satisfies DesktopMessageAttachment;
			} catch (cause) {
				throw attachmentError({
					cause,
					message: "The attachment could not be prepared. Check that the file is still available.",
				});
			}
		},

		release(ids) {
			if (!Array.isArray(ids)) throw attachmentError({ message: "Attachment ids must be an array" });
			for (const id of ids) if (typeof id === "string") records.delete(id);
		},

		resolve(id) {
			const attachment = records.get(id);
			if (attachment) return attachment;
			throw attachmentError({ message: `Attachment is no longer available: ${id}` });
		},

		clear() {
			records.clear();
		},
	};
}
