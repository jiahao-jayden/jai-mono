import type { LandingCopy } from "@/content";

export function Footer({ copy }: { copy: LandingCopy }) {
	const year = new Date().getFullYear();
	return (
		<footer className="bg-ink text-page">
			<div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
				<div className="flex items-center gap-3">
					<span className="font-display text-[22px] leading-none">PandaWork</span>
					<span className="text-[13px] text-page/70">{copy.footer.tagline}</span>
				</div>
				<p className="text-[13px] text-page/70">
					© {year} {copy.footer.copyright}
				</p>
			</div>
		</footer>
	);
}
