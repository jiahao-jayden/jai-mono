import "@/app/globals.css";
import type { ReactNode } from "react";
import { LOCALE_TAG, type Locale } from "@/content";

/**
 * `<html>` shell shared by the per-locale root layouts. Each locale owns its
 * own root layout (route groups) because a static export cannot read the
 * request to pick `<html lang>` at runtime.
 */
export function RootDocument({
	locale,
	fontClassName,
	children,
}: {
	locale: Locale;
	fontClassName: string;
	children: ReactNode;
}) {
	return (
		<html lang={LOCALE_TAG[locale]} className={fontClassName}>
			<body>{children}</body>
		</html>
	);
}
