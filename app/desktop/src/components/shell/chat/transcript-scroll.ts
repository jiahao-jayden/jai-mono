export const transcriptPromptInset = 24;
export const transcriptComfortLine = 0.72;
export const transcriptBottomThreshold = 24;
const transcriptScrollKeys = new Set(["ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "]);

export function promptAnchorScrollTop(promptTop: number): number {
	return Math.max(0, promptTop - transcriptPromptInset);
}

export function comfortableScrollTop(scrollTop: number, viewportHeight: number, contentBottom: number): number {
	const comfortLine = scrollTop + viewportHeight * transcriptComfortLine;
	return contentBottom > comfortLine ? contentBottom - viewportHeight * transcriptComfortLine : scrollTop;
}

export function isTranscriptScrollKey(key: string): boolean {
	return transcriptScrollKeys.has(key);
}

export function isTranscriptAwayFromBottom(scrollTop: number, viewportHeight: number, scrollHeight: number): boolean {
	return scrollHeight - scrollTop - viewportHeight > transcriptBottomThreshold;
}
