export type Locale = "en" | "zh";

/**
 * A headline split around one emphasized phrase. English renders the phrase in
 * italic serif; Chinese has no true italic, so it renders in a softer tone.
 */
export interface Headline {
	lead: string;
	emphasis: string;
	tail: string;
}

export interface LandingCopy {
	meta: {
		title: string;
		description: string;
	};
	nav: {
		features: string;
		models: string;
		privacy: string;
		download: string;
		switchLocale: string;
		home: string;
		github: string;
	};
	hero: {
		badge: string;
		title: Headline;
		description: string;
		download: string;
		secondary: string;
		screenshotAlt: string;
	};
	features: {
		eyebrow: string;
		title: Headline;
		description: string;
		items: readonly { title: string; description: string }[];
		screenshotAlt: string;
	};
	models: {
		eyebrow: string;
		title: Headline;
		description: string;
		items: readonly { name: string; description: string }[];
	};
	privacy: {
		eyebrow: string;
		title: Headline;
		description: string;
		items: readonly { title: string; description: string }[];
	};
	closing: {
		title: Headline;
		description: string;
		download: string;
		comingSoon: string;
		note: string;
	};
	footer: {
		tagline: string;
		copyright: string;
	};
}
