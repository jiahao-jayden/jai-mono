import type { AgentMessage } from "@jai/agent";
import type { ImageContent } from "@jai/ai";
import { TaggedError } from "better-result";

export interface CodingMessageAttachment {
	readonly id: string;
	readonly filename: string;
	readonly mimeType: string;
	readonly size: number;
	readonly sourcePath: string;
	readonly image?: () => Promise<ImageContent>;
}

class AttachmentRunAlreadyActive extends TaggedError("coding_attachment.run_already_active")<{
	readonly message: string;
}> {}
class DuplicateAttachmentId extends TaggedError("coding_attachment.duplicate_id")<{
	readonly message: string;
}> {}

export class CodingAttachmentRun {
	#active: readonly CodingMessageAttachment[] | undefined;

	async invoke<T>(attachments: readonly CodingMessageAttachment[], run: () => Promise<T>): Promise<T> {
		if (this.#active) {
			throw new AttachmentRunAlreadyActive({ message: "Attachment context is already active" });
		}
		assertUniqueIds(attachments);
		this.#active = attachments;
		try {
			return await run();
		} finally {
			this.#active = undefined;
		}
	}

	async project(messages: readonly AgentMessage[]): Promise<AgentMessage[] | undefined> {
		const active = this.#active;
		if (!active || active.length === 0) return undefined;
		const ids = active.map((attachment) => attachment.id);
		const targetIndex = findAttachmentMessage(messages, ids);
		if (targetIndex < 0) return undefined;
		const target = messages[targetIndex];
		if (target?.role !== "user") return undefined;
		const content =
			typeof target.content === "string" ? [{ type: "text" as const, text: target.content }] : [...target.content];
		const attachments = await Promise.all(
			active.map(async (attachment) =>
				attachment.image
					? attachment.image()
					: {
							type: "text" as const,
							text: `Attachment: ${attachment.filename} (${attachment.sourcePath})`,
						},
			),
		);
		const next = [...messages];
		next[targetIndex] = {
			...target,
			content: [...content, ...attachments],
		};
		return next;
	}
}

export function attachmentUserMessage(input: {
	readonly text: string;
	readonly attachments: readonly Pick<CodingMessageAttachment, "id" | "filename" | "mimeType" | "size">[];
	readonly timestamp?: number;
}): Extract<AgentMessage, { readonly role: "user" }> {
	return {
		role: "user",
		content: input.text,
		metadata: {
			messageAttachments: input.attachments.map(({ id, filename, mimeType, size }) => ({
				id,
				filename,
				mimeType,
				size,
			})),
		},
		timestamp: input.timestamp ?? Date.now(),
	};
}

function findAttachmentMessage(messages: readonly AgentMessage[], ids: readonly string[]): number {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role !== "user") continue;
		const value = message.metadata?.messageAttachments;
		if (!Array.isArray(value) || value.length !== ids.length) continue;
		const messageIds = value.flatMap((item) => (isRecord(item) && typeof item.id === "string" ? [item.id] : []));
		if (messageIds.length === ids.length && messageIds.every((id, itemIndex) => id === ids[itemIndex])) return index;
	}
	return -1;
}

function assertUniqueIds(attachments: readonly CodingMessageAttachment[]): void {
	const ids = new Set<string>();
	for (const attachment of attachments) {
		if (ids.has(attachment.id))
			throw new DuplicateAttachmentId({ message: `Duplicate attachment id: ${attachment.id}` });
		ids.add(attachment.id);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
