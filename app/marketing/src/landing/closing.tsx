import type { LandingCopy, Locale } from "@/content";
import { ButtonLink, DisplayTitle, PendingButton } from "./primitives";

export function Closing({
	locale,
	copy,
	downloadUrl,
}: {
	locale: Locale;
	copy: LandingCopy;
	downloadUrl: string | null;
}) {
	const downloadAction =
		downloadUrl === null ? (
			<PendingButton>{copy.closing.comingSoon}</PendingButton>
		) : (
			<ButtonLink href={downloadUrl} variant="primary">
				{copy.closing.download}
			</ButtonLink>
		);

	return (
		<section id="download" aria-labelledby="closing-title" className="relative overflow-hidden">
			<div aria-hidden="true" className="painting-rock absolute inset-0" />
			<div
				aria-hidden="true"
				className="absolute inset-0 bg-linear-to-b from-page from-5% via-page/55 via-45% to-transparent"
			/>
			<div className="reveal relative mx-auto flex max-w-3xl flex-col items-center px-4 pt-28 pb-[clamp(18rem,40vw,30rem)] text-center sm:px-6 sm:pt-36">
				<DisplayTitle
					id="closing-title"
					locale={locale}
					title={copy.closing.title}
					className="flex flex-col text-[2.5rem] leading-[1.08] sm:text-[3.5rem]"
				/>
				<p className="mt-6 max-w-lg text-[15px] text-ink-secondary leading-[1.7] sm:text-[16px]">
					{copy.closing.description}
				</p>
				<div className="mt-9">{downloadAction}</div>
				<p className="mt-4 text-[13px] text-ink-secondary">{copy.closing.note}</p>
			</div>
		</section>
	);
}
