import type { DesktopMessageAttachment } from "../../shared/desktop-rpc";

const filesByAttachmentId = new Map<string, File>();

export function rememberAttachmentFiles(
	attachments: readonly DesktopMessageAttachment[],
	files: readonly File[],
): void {
	for (const [index, attachment] of attachments.entries()) {
		const file = files[index];
		if (file) filesByAttachmentId.set(attachment.id, file);
	}
}

export function filesForAttachments(attachments: readonly DesktopMessageAttachment[]): File[] {
	return attachments.flatMap((attachment) => {
		const file = filesByAttachmentId.get(attachment.id);
		return file ? [file] : [];
	});
}
