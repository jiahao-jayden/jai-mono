import type { LandingCopy, Locale } from "@/content";
import { ButtonLink, DisplayTitle } from "./primitives";
import { Screenshot } from "./screenshot";

export function Hero({ locale, copy, downloadHref }: { locale: Locale; copy: LandingCopy; downloadHref: string }) {
	return (
		<section aria-labelledby="hero-title" className="relative">
			{/* The painting fades into the page ground so the screenshot can overlap its lower edge. */}
			<div
				aria-hidden="true"
				className="painting-hero absolute inset-x-0 top-0 h-[min(92svh,860px)] min-h-[560px] mask-b-from-70% mask-b-to-100%"
			/>
			<div
				aria-hidden="true"
				className="absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(50%_60%_at_50%_45%,color-mix(in_oklch,var(--page)_85%,transparent)_45%,transparent)]"
			/>

			<div className="relative mx-auto flex max-w-6xl flex-col items-center px-4 pt-16 text-center sm:px-6 sm:pt-24">
				<p className="rounded-full bg-surface/75 px-3 py-1 font-medium text-[12px] text-ink-secondary shadow-[0_0_0_.5px_var(--color-line)] backdrop-blur-sm">
					{copy.hero.badge}
				</p>
				<DisplayTitle
					as="h1"
					id="hero-title"
					locale={locale}
					title={copy.hero.title}
					className="mt-6 max-w-3xl text-[3rem] leading-[1] sm:text-[4.75rem]"
				/>
				<p className="mt-6 max-w-xl text-[16px] text-ink-secondary leading-[1.7] sm:text-[17px]">
					{copy.hero.description}
				</p>
				<div className="mt-9 flex flex-wrap items-center justify-center gap-3">
					<ButtonLink href={downloadHref} variant="primary">
						{copy.hero.download}
					</ButtonLink>
					<ButtonLink href="#features" variant="secondary">
						{copy.hero.secondary}
					</ButtonLink>
				</div>

				<div className="mt-[clamp(8rem,20vw,16rem)] w-full max-w-5xl">
					<Screenshot name="overview" alt={copy.hero.screenshotAlt} priority />
				</div>
			</div>
		</section>
	);
}
