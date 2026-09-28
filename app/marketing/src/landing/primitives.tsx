import { cn } from "cn";
import type { ReactNode } from "react";
import type { Headline, Locale } from "@/content";

/**
 * Serif display headline with one emphasized phrase. Latin scripts get the
 * italic face; Chinese has no true italic, so emphasis drops to a softer ink.
 */
export function DisplayTitle({
	as: Tag = "h2",
	id,
	locale,
	title,
	className,
}: {
	as?: "h1" | "h2";
	id?: string;
	locale: Locale;
	title: Headline;
	className?: string;
}) {
	const emphasisClassName = cn(locale === "en" ? "italic" : "text-ink-secondary");
	return (
		<Tag
			id={id}
			className={cn(
				"text-balance font-display font-normal text-ink tracking-[-0.02em]",
				locale === "zh" && "font-medium tracking-normal",
				className,
			)}
		>
			{title.lead}
			<em className={cn("not-italic", emphasisClassName)}>{title.emphasis}</em>
			{title.tail}
		</Tag>
	);
}

export function SectionHeader({
	id,
	locale,
	eyebrow,
	title,
	description,
}: {
	id: string;
	locale: Locale;
	eyebrow: string;
	title: Headline;
	description: string;
}) {
	return (
		<header className="mx-auto max-w-2xl text-center">
			<p className="font-medium text-[12px] text-brand uppercase tracking-[0.14em]">{eyebrow}</p>
			<DisplayTitle
				id={id}
				locale={locale}
				title={title}
				className="mt-4 text-[2.5rem] leading-[1.05] sm:text-[3.5rem]"
			/>
			<p className="mt-5 text-[15px] text-ink-secondary leading-[1.7] sm:text-[16px]">{description}</p>
		</header>
	);
}

const buttonVariants = {
	primary: "bg-ink text-page hover:bg-ink/85",
	secondary: "bg-surface/80 text-ink shadow-[0_0_0_.5px_var(--color-line-strong)] backdrop-blur-sm hover:bg-surface",
} as const;

export function ButtonLink({
	href,
	variant,
	children,
	className,
}: {
	href: string;
	variant: keyof typeof buttonVariants;
	children: ReactNode;
	className?: string;
}) {
	return (
		<a
			href={href}
			className={cn(
				"inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-5 font-medium text-[14px] transition-colors",
				buttonVariants[variant],
				className,
			)}
		>
			{children}
		</a>
	);
}

/** Placeholder for a download button while no release channel exists. */
export function PendingButton({ children }: { children: ReactNode }) {
	return (
		<span
			aria-disabled="true"
			className="inline-flex h-11 cursor-default items-center justify-center rounded-[10px] bg-ink/70 px-5 font-medium text-[14px] text-page"
		>
			{children}
		</span>
	);
}
