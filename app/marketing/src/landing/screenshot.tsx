import { cn } from "cn";

const SCREENSHOTS = {
	overview: { width: 2498, height: 1652 },
	artifact: { width: 2486, height: 1646 },
} as const;

/**
 * A product screenshot framed like a window resting on the page. Two
 * pre-sized WebP files cover regular and high-density screens, since the
 * static export has no image optimizer.
 */
export function Screenshot({
	name,
	alt,
	priority = false,
	className,
}: {
	name: keyof typeof SCREENSHOTS;
	alt: string;
	priority?: boolean;
	className?: string;
}) {
	const { width, height } = SCREENSHOTS[name];
	return (
		<div
			className={cn(
				"rounded-2xl bg-surface/60 p-2 shadow-[0_0_0_.5px_var(--color-line-strong),0_30px_60px_-30px_rgb(40_30_10/.35)] backdrop-blur-sm sm:p-3",
				className,
			)}
		>
			<img
				src={`/${name}-1280.webp`}
				srcSet={`/${name}-1280.webp 1280w, /${name}-2400.webp 2400w`}
				sizes="(min-width: 1024px) 1000px, 100vw"
				width={width}
				height={height}
				alt={alt}
				loading={priority ? "eager" : "lazy"}
				fetchPriority={priority ? "high" : "auto"}
				decoding="async"
				className="block h-auto w-full rounded-xl"
			/>
		</div>
	);
}
