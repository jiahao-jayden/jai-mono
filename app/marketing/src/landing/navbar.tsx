import type { LandingCopy, Locale } from "@/content";
import { LOCALE_PATH } from "@/content";
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
			<nav className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
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
					<ButtonLink href={downloadHref} variant="primary">
						{copy.nav.download}
					</ButtonLink>
				</div>
			</nav>
		</header>
	);
}
