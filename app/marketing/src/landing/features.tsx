import type { LandingCopy, Locale } from "@/content";
import { SectionHeader } from "./primitives";
import { Screenshot } from "./screenshot";

export function Features({ locale, copy }: { locale: Locale; copy: LandingCopy }) {
	return (
		<section id="features" aria-labelledby="features-title" className="px-4 py-24 sm:px-6 sm:py-32">
			<div className="reveal">
				<SectionHeader
					id="features-title"
					locale={locale}
					eyebrow={copy.features.eyebrow}
					title={copy.features.title}
					description={copy.features.description}
				/>
			</div>

			<div className="mx-auto mt-16 grid max-w-6xl items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
				<ol className="reveal flex flex-col">
					{copy.features.items.map((item, index) => (
						<li key={item.title} className="flex gap-5 border-line border-t py-6 first:border-t-0">
							<span className="pt-0.5 font-mono text-[12px] text-ink-tertiary tabular-nums">
								{String(index + 1).padStart(2, "0")}
							</span>
							<div>
								<h3 className="font-medium text-[16px] text-ink">{item.title}</h3>
								<p className="mt-2 text-[14px] text-ink-secondary leading-[1.65]">{item.description}</p>
							</div>
						</li>
					))}
				</ol>

				<div className="reveal painting-sky rounded-3xl p-4 sm:p-8">
					<Screenshot name="artifact" alt={copy.features.screenshotAlt} />
				</div>
			</div>
		</section>
	);
}
