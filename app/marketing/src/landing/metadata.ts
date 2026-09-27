import type { Metadata } from "next";
import { LOCALE_PATH, LOCALE_TAG, LOCALES, type Locale, resolveCopy, SITE_URL } from "@/content";

export function projectMetadata(locale: Locale): Metadata {
	const copy = resolveCopy(locale);
	const languages = Object.fromEntries(LOCALES.map((l) => [LOCALE_TAG[l], LOCALE_PATH[l]]));
	return {
		metadataBase: SITE_URL,
		title: copy.meta.title,
		description: copy.meta.description,
		alternates: {
			canonical: LOCALE_PATH[locale],
			languages: { ...languages, "x-default": LOCALE_PATH.en },
		},
		openGraph: {
			type: "website",
			siteName: "PandaWork",
			title: copy.meta.title,
			description: copy.meta.description,
			url: LOCALE_PATH[locale],
			locale: LOCALE_TAG[locale],
			images: [{ url: "/og.jpg", width: 1200, height: 630, alt: "PandaWork" }],
		},
		twitter: {
			card: "summary_large_image",
			title: copy.meta.title,
			description: copy.meta.description,
			images: ["/og.jpg"],
		},
		icons: { icon: "/icon.png", apple: "/icon.png" },
	};
}
