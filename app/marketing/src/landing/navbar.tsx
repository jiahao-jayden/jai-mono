import type { LandingCopy, Locale } from "@/content";
import { GITHUB_URL, LOCALE_PATH } from "@/content";
import { ButtonLink } from "./primitives";

export function Navbar({ locale, copy, downloadHref }: { locale: Locale; copy: LandingCopy; downloadHref: string }) {
	const otherLocale: Locale = locale === "en" ? "zh" : "en";
	const links = [
		{ href: "#features", label: copy.nav.features },
		{ href: "#models", label: copy.nav.models },
		{ href: "#privacy", label: copy.nav.privacy },
	];

	return (
		<header className="sticky top-0 z-30 border-line border-b bg-page/70 backdrop-blur-md">
			<nav className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-4 sm:px-6">
				<a href={LOCALE_PATH[locale]} aria-label={copy.nav.home} className="flex items-center gap-2 rounded-md">
					<img src="/logo.svg" alt="" width={28} height={28} className="size-7" />
					<span className="font-display text-[22px] text-ink leading-none">PandaWork</span>
				</a>

				<ul className="mx-auto hidden items-center gap-1 md:flex">
					{links.map((link) => (
						<li key={link.href}>
							<a
								href={link.href}
								className="rounded-md px-3 py-2 text-[14px] text-ink-secondary transition-colors hover:text-ink"
							>
								{link.label}
							</a>
						</li>
					))}
				</ul>

				<div className="ml-auto flex items-center gap-2 md:ml-0">
					<a
						href={LOCALE_PATH[otherLocale]}
						hrefLang={otherLocale === "zh" ? "zh-CN" : "en"}
						className="rounded-md px-3 py-2 text-[14px] text-ink-secondary transition-colors hover:text-ink"
					>
						{copy.nav.switchLocale}
					</a>
					<a
						href={GITHUB_URL}
						target="_blank"
						rel="noopener noreferrer"
						aria-label={copy.nav.github}
						className="flex size-8 items-center justify-center rounded-md text-ink-secondary transition-colors hover:text-ink"
					>
						<svg viewBox="0 0 16 16" aria-hidden="true" className="size-5">
							<path
								fill="currentColor"
								d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
							/>
						</svg>
					</a>
					<ButtonLink href={downloadHref} variant="primary" className="h-8 px-3.5">
						{copy.nav.download}
					</ButtonLink>
				</div>
			</nav>
		</header>
	);
}
