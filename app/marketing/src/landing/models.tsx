import type { LandingCopy, Locale } from "@/content";
import { SectionHeader } from "./primitives";

export function Models({ locale, copy }: { locale: Locale; copy: LandingCopy }) {
	return (
		<section id="models" aria-labelledby="models-title" className="px-2 sm:px-4">
			{/* A sky panel with a cream wash, echoing the painting without competing with the text. */}
			<div className="painting-sky relative mx-auto max-w-7xl overflow-hidden rounded-[28px]">
				<div aria-hidden="true" className="absolute inset-0 bg-page/70" />
				<div className="relative px-4 py-20 sm:px-10 sm:py-28">
					<div className="reveal">
						<SectionHeader
							id="models-title"
							locale={locale}
							eyebrow={copy.models.eyebrow}
							title={copy.models.title}
							description={copy.models.description}
						/>
					</div>
					<ul className="reveal mx-auto mt-14 grid max-w-5xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
						{copy.models.items.map((item) => (
							<li
								key={item.name}
								className="rounded-2xl bg-surface/85 p-5 shadow-[0_0_0_.5px_var(--color-line)] backdrop-blur-sm"
							>
								<h3 className="font-medium text-[15px] text-ink">{item.name}</h3>
								<p className="mt-2 text-[13px] text-ink-secondary leading-[1.6]">{item.description}</p>
							</li>
						))}
					</ul>
				</div>
			</div>
		</section>
	);
}
