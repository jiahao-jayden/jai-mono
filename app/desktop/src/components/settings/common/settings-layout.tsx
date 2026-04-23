import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingsPageProps {
	children: ReactNode;
	className?: string;
	/** Set to `flush` when the page manages its own inner layout (e.g. split view). */
	variant?: "default" | "flush";
}

export function SettingsPage({ children, className, variant = "default" }: SettingsPageProps) {
	if (variant === "flush") {
		return <div className={cn("flex h-full flex-col", className)}>{children}</div>;
	}
	return (
		<div className={cn("mx-auto w-full max-w-[680px] px-8 pt-4 pb-16", className)}>
			<div className="flex flex-col gap-10">{children}</div>
		</div>
	);
}

interface SettingsHeaderProps {
	title: string;
	description?: ReactNode;
	action?: ReactNode;
	className?: string;
}

export function SettingsHeader({ title, description, action, className }: SettingsHeaderProps) {
	return (
		<header className={cn("flex flex-col gap-3 border-b border-border/40 pb-6", className)}>
			<div className="flex items-end justify-between gap-4">
				<h1 className="font-serif text-[34px] leading-[1.08] tracking-[-0.01em] text-foreground">{title}</h1>
				{action && <div className="shrink-0 pb-1">{action}</div>}
			</div>
			{description && (
				<p className="max-w-[58ch] text-[13.5px] leading-relaxed text-muted-foreground/70">{description}</p>
			)}
		</header>
	);
}

interface SettingsGroupProps {
	title?: string;
	description?: ReactNode;
	action?: ReactNode;
	children: ReactNode;
	className?: string;
	/** When true, suppress the inner divider between rows. Useful when children manage their own layout. */
	bare?: boolean;
}

export function SettingsGroup({ title, description, action, children, className, bare = false }: SettingsGroupProps) {
	return (
		<section className={cn("flex flex-col gap-3", className)}>
			{(title || action) && (
				<div className="flex items-end justify-between gap-3 px-1">
					<div className="flex flex-col gap-1">
						{title && (
							<h2 className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60">
								{title}
							</h2>
						)}
						{description && <p className="text-[12.5px] leading-snug text-muted-foreground/60">{description}</p>}
					</div>
					{action && <div className="shrink-0">{action}</div>}
				</div>
			)}
			<div
				className={cn(
					"overflow-hidden rounded-2xl bg-card/70 ring-1 ring-border/45",
					!bare && "divide-y divide-border/35",
				)}
			>
				{children}
			</div>
		</section>
	);
}

interface SettingsRowProps {
	icon?: IconSvgElement;
	title: ReactNode;
	description?: ReactNode;
	control?: ReactNode;
	/** Render the control underneath instead of on the right. Useful for wider inputs. */
	stacked?: boolean;
	className?: string;
	/** Optional footer rendered below description+control (e.g. helper link). */
	footer?: ReactNode;
}

export function SettingsRow({
	icon,
	title,
	description,
	control,
	stacked = false,
	className,
	footer,
}: SettingsRowProps) {
	return (
		<div className={cn("flex gap-4 px-4 py-3.5", stacked ? "flex-col" : "flex-row items-center", className)}>
			<div className="flex min-w-0 flex-1 items-start gap-3">
				{icon && (
					<span
						aria-hidden
						className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary-2/10 text-primary-2 ring-1 ring-primary-2/15"
					>
						<HugeiconsIcon icon={icon} size={14} strokeWidth={1.75} />
					</span>
				)}
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<div className="text-[13.5px] font-medium text-foreground leading-snug">{title}</div>
					{description && <div className="text-[12px] leading-snug text-muted-foreground/65">{description}</div>}
					{stacked && control && <div className="mt-2.5">{control}</div>}
					{footer && <div className="mt-1.5">{footer}</div>}
				</div>
			</div>
			{!stacked && control && <div className="shrink-0">{control}</div>}
		</div>
	);
}

interface SettingsFieldProps {
	label: ReactNode;
	hint?: ReactNode;
	children: ReactNode;
	className?: string;
	optional?: boolean;
}

/** Vertical label + control pair used inside provider config forms. */
export function SettingsField({ label, hint, children, className, optional }: SettingsFieldProps) {
	return (
		<div className={cn("flex flex-col gap-1.5 px-4 py-3.5", className)}>
			<div className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground/80">
				<span>{label}</span>
				{optional && (
					<span className="text-[10.5px] font-normal uppercase tracking-wider text-muted-foreground/40">
						Optional
					</span>
				)}
			</div>
			{children}
			{hint && <div className="text-[11.5px] leading-snug text-muted-foreground/50">{hint}</div>}
		</div>
	);
}
