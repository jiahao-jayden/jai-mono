import { useEffect, useState } from "react";

export function useElementWidth<T extends HTMLElement>(ref: React.RefObject<T | null>): number | null {
	const [width, setWidth] = useState<number | null>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;

		setWidth(el.getBoundingClientRect().width);
		const ro = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const next = entry.contentRect.width;
			setWidth((prev) => (prev === null || Math.abs(prev - next) >= 0.5 ? next : prev));
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, [ref]);

	return width;
}
