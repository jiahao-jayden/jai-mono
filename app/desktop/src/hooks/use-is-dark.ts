import { useEffect, useState } from "react";

/** Track whether the root element currently has the `dark` class. */
export function useIsDark(): boolean {
	const [dark, setDark] = useState(
		() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
	);

	useEffect(() => {
		const observer = new MutationObserver(() => {
			setDark(document.documentElement.classList.contains("dark"));
		});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});
		return () => observer.disconnect();
	}, []);

	return dark;
}
