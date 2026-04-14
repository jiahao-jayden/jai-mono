export const PASTED_TEXT_ATTACHMENT_THRESHOLD = 200;
export const PASTED_TEXT_ATTACHMENT_NAME = "pasted-content.txt";

export function createPastedTextAttachment(text: string): File | null {
	if (text.length <= PASTED_TEXT_ATTACHMENT_THRESHOLD) return null;
	return new File([text], PASTED_TEXT_ATTACHMENT_NAME, {
		type: "text/plain",
	});
}
