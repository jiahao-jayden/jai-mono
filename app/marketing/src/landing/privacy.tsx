import type { LandingCopy, Locale } from "@/content";
import { SectionHeader } from "./primitives";

export function Privacy({ locale, copy }: { locale: Locale; copy: LandingCopy }) {
	return (
		<section id="privacy" aria-labelledby="privacy-title" className="px-4 py-24 sm:px-6 sm:py-32">
			<div className="reveal flex flex-col items-center">
				<img src="/logo.svg" alt="" width={48} height={48} className="mb-8 size-12" />
				<SectionHeader
					id="privacy-title"
					locale={locale}
					eyebrow={copy.privacy.eyebrow}
					title={copy.privacy.title}
					description={copy.privacy.description}
				/>
			</div>
			<ul className="reveal mx-auto mt-16 grid max-w-5xl gap-10 text-center sm:grid-cols-3 sm:gap-8">
				{copy.privacy.items.map((item) => (
					<li key={item.title}>
						<h3 className="font-display text-[1.6rem] text-ink leading-tight">{item.title}</h3>
						<p className="mx-auto mt-3 max-w-xs text-[14px] text-ink-secondary leading-[1.65]">
							{item.description}
						</p>
					</li>
				))}
			</ul>
		</section>
	);
}
