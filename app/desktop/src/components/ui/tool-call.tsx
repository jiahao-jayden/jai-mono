"use client";

import { Collapsible } from "@base-ui/react/collapsible";
import { type HTMLAttributes, useState } from "react";
import { type IconComponent, type IconName, useIcon } from "@/lib/icon-context";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { cn } from "@/lib/utils";

export type ToolCallStatus = "running" | "complete";

interface ToolCallProps extends HTMLAttributes<HTMLDivElement> {
	readonly icon?: IconName;
	readonly label: string;
	readonly summary?: string;
	readonly details?: string;
	readonly status?: ToolCallStatus;
}

export function ToolCall({
	icon = "terminal",
	label,
	summary,
	details,
	status = "complete",
	className,
	...props
}: ToolCallProps) {
	const [open, setOpen] = useState(false);
	const ToolIcon = useIcon(icon);
	const CheckIcon = useIcon("check");
	const ChevronIcon = useIcon("chevron-right");
	const shape = useShape();
	const expandable = Boolean(details);
	const rowClassName = cn("relative z-10 flex min-w-0 w-full gap-2 px-1 py-0.5 text-left", shape.item);

	const row = (
		<>
			<div className="flex w-3.25 shrink-0 justify-center pt-px">
				<ToolIcon
					size={13}
					strokeWidth={1.5}
					className="text-muted-foreground/75"
				/>
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex min-w-0 items-center gap-1.5">
					<span
						className={cn(
							"min-w-0 truncate text-[12.5px] leading-tight",
							status === "running"
								? "shimmer-text text-foreground"
								: "text-foreground/80",
						)}
						style={{ fontVariationSettings: fontWeights.medium }}
					>
						{label}
						{status === "running" ? "…" : null}
					</span>
					<ToolCallState status={status} CheckIcon={CheckIcon} />
				</div>
				{summary ? (
					<span className="truncate text-[12px] leading-snug text-muted-foreground">{summary}</span>
				) : null}
			</div>
			{expandable ? (
				<span
					className={cn(
						"ml-auto mt-px inline-flex size-3.25 shrink-0 items-center justify-center text-muted-foreground/70 transition-transform duration-150 motion-reduce:transition-none",
						open && "rotate-90",
					)}
				>
					<ChevronIcon size={13} strokeWidth={1.5} />
				</span>
			) : null}
		</>
	);

	return (
		<div className={cn("relative min-w-0 w-full", className)} {...props}>
			<Collapsible.Root open={open} onOpenChange={setOpen} className="min-w-0 w-full">
				{expandable ? (
					<Collapsible.Trigger
						className={cn(
							rowClassName,
							"outline-none transition-colors duration-80 hover:bg-hover",
							"focus-visible:ring-1 focus-visible:ring-(--focus-ring,#6B97FF)",
						)}
					>
						{row}
					</Collapsible.Trigger>
				) : (
					<div className={rowClassName}>{row}</div>
				)}
				{expandable ? (
					<Collapsible.Panel className="box-border min-w-0 w-full overflow-hidden pl-5">
						<pre className="mt-1 box-border max-h-64 min-w-0 w-full max-w-full overflow-auto rounded-lg bg-muted/60 px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
							{details}
						</pre>
					</Collapsible.Panel>
				) : null}
			</Collapsible.Root>
		</div>
	);
}

function ToolCallState({
	status,
	CheckIcon,
}: {
	readonly status: ToolCallStatus;
	readonly CheckIcon: IconComponent;
}) {
	if (status === "running") {
		return (
			<span
				className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary-2 motion-reduce:animate-none"
				aria-label="Running"
			/>
		);
	}
	return <CheckIcon size={13} strokeWidth={1.75} className="shrink-0 text-muted-foreground" aria-label="Complete" />;
}
