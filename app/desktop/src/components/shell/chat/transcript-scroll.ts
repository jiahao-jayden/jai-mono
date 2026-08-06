// Fraction of the viewport height a just-sent prompt is offset from the top
// when it comes to rest. Larger values keep the prompt lower on screen (less
// upward travel, and a smaller tail spacer below short replies).
export const transcriptPromptAnchorRatio = 0.3;
export const transcriptComfortLine = 0.72;
export const transcriptBottomThreshold = 24;
const transcriptScrollKeys = new Set(["ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "]);

export function promptAnchorScrollTop(promptTop: number, viewportHeight: number): number {
	return Math.max(0, promptTop - viewportHeight * transcriptPromptAnchorRatio);
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
