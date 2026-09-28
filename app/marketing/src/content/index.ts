import { en } from "./en";
import type { LandingCopy, Locale } from "./types";
import { zh } from "./zh";

export type { Headline, LandingCopy, Locale } from "./types";

export const LOCALES = ["en", "zh"] as const satisfies readonly Locale[];

const COPY: Record<Locale, LandingCopy> = { en, zh };

/** Route of each locale's page; English is the default and owns `/`. */
export const LOCALE_PATH: Record<Locale, string> = { en: "/", zh: "/zh/" };

/** Value for `<html lang>` and hreflang. */
export const LOCALE_TAG: Record<Locale, string> = { en: "en", zh: "zh-CN" };

/**
 * Where the download buttons point. `null` until a release channel exists:
 * the hero button then scrolls to the closing section, and the closing button
 * renders as "coming soon". Set this once installers are published.
 */
export const DOWNLOAD_URL: string | null = null;

export const GITHUB_URL = "https://github.com/jiahao-jayden/jai-mono";

/**
 * Canonical origin used for canonical/hreflang/OG URLs. Set `SITE_URL` when
 * building for deployment; local builds use the dev server origin.
 */
export const SITE_URL = new URL(process.env.SITE_URL ?? "http://localhost:4322");

export function resolveCopy(locale: Locale): LandingCopy {
	return COPY[locale];
}
