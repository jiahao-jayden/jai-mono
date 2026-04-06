import { useCallback, useEffect, useRef } from "react";
import getCaretCoordinates from "textarea-caret";

export function useCursorEffect() {
	const wrapperRef = useRef<HTMLDivElement>(null);
	const cursorRef = useRef<HTMLDivElement>(null);
	const typingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const cursorVisibleRef = useRef(false);

	const getTextarea = useCallback(
		() => wrapperRef.current?.querySelector("textarea") as HTMLTextAreaElement | null,
		[],
	);

	const updateCursor = useCallback(
		(isTyping: boolean) => {
			const textarea = getTextarea();
			const cursor = cursorRef.current;
			if (!textarea || !cursor || document.activeElement !== textarea) return;

			const pos = textarea.selectionEnd;
			const caret = getCaretCoordinates(textarea, pos);
			const lineH = caret.height || Number.parseFloat(getComputedStyle(textarea).lineHeight) || 20;

			if (!cursorVisibleRef.current) {
				cursor.style.transition = "none";
				cursor.style.left = `${caret.left}px`;
				cursor.style.top = `${caret.top - textarea.scrollTop}px`;
				cursor.style.height = `${lineH * 0.75}px`;
				cursor.offsetHeight;
				cursor.style.transition = "";
				cursor.classList.remove("opacity-0");
				cursor.classList.add("cursor-idle");
				cursorVisibleRef.current = true;
			} else {
				cursor.style.left = `${caret.left}px`;
				cursor.style.top = `${caret.top - textarea.scrollTop}px`;
				cursor.style.height = `${lineH * 0.75}px`;
			}

			if (isTyping) {
				cursor.classList.remove("cursor-idle");
				cursor.classList.add("cursor-typing");
				clearTimeout(typingTimerRef.current);
				typingTimerRef.current = setTimeout(() => {
					cursor.classList.remove("cursor-typing");
					cursor.classList.add("cursor-idle");
				}, 400);
			} else if (!cursor.classList.contains("cursor-typing")) {
				cursor.classList.add("cursor-idle");
			}
		},
		[getTextarea],
	);

	const onFocus = useCallback(() => {
		cursorVisibleRef.current = false;
		updateCursor(false);
	}, [updateCursor]);
	const onBlur = useCallback(() => {
		const cursor = cursorRef.current;
		if (!cursor) return;
		cursor.classList.add("opacity-0");
		cursor.classList.remove("cursor-idle", "cursor-typing");
		cursorVisibleRef.current = false;
	}, []);
	const onKeyUp = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key.includes("Arrow") || e.key === "Home" || e.key === "End") updateCursor(false);
		},
		[updateCursor],
	);
	const onMouseUp = useCallback(() => updateCursor(false), [updateCursor]);
	const onScroll = useCallback(() => updateCursor(false), [updateCursor]);
	const onChange = useCallback(() => updateCursor(true), [updateCursor]);

	useEffect(() => {
		const onResize = () => {
			if (cursorVisibleRef.current) updateCursor(false);
		};
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [updateCursor]);

	const resetCursor = useCallback(() => {
		cursorVisibleRef.current = false;
		// Defer so the textarea value is already cleared when we recalculate
		requestAnimationFrame(() => updateCursor(false));
	}, [updateCursor]);

	return {
		wrapperRef,
		cursorRef,
		resetCursor,
		handlers: { onFocus, onBlur, onKeyUp, onMouseUp, onScroll, onChange },
	};
}
