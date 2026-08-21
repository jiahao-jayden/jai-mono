"use client";

import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { type IconName, useIcon } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import { collapsePanel, ShimmerLabel, SwapLabel } from "./surfaces";

export interface TimelineStep {
	id: string;
	verb: string;
	chip?: string;
	icon: IconName;
	details?: string;
	active?: boolean;
}

export interface ToolTimelineProps {
	steps: readonly TimelineStep[];
	streaming: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	restingLabel: string;
	activeLabel: string;
	className?: string;
}

export function ToolTimeline({
	steps,
	streaming,
	open,
	onOpenChange,
	restingLabel,
	activeLabel,
	className,
}: ToolTimelineProps) {
	const ChevronRight = useIcon("chevron-right");
	const chevronClassName = cn(
		"inline-flex shrink-0 opacity-60 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
		open && "rotate-90",
	);

	return (
		<Collapsible
			data-slot="tool-timeline"
			open={open}
			onOpenChange={onOpenChange}
			className={cn("w-full max-w-sm", className)}
		>
			<CollapsibleTrigger className="group/trigger flex items-center gap-1.5 rounded-md py-1 text-[13.5px] text-foreground/55 outline-none transition-colors hover:text-foreground/90">
				<span className={chevronClassName}>
					<ChevronRight size={14} strokeWidth={1.5} />
				</span>
				<SwapLabel active={streaming ? 0 : 1} className="text-start tabular-nums">
					<ShimmerLabel active={streaming} className="relative inline-block leading-none">
						{activeLabel}
					</ShimmerLabel>
					{restingLabel}
				</SwapLabel>
			</CollapsibleTrigger>
			<CollapsibleContent className={cn(collapsePanel, "outline-none")}>
				<div className="flex flex-col gap-2.5 ps-4 pt-2.5">
					{steps.map((step, index) => {
						const active = streaming && (step.active ?? index === steps.length - 1);
						return <ToolTimelineStep key={step.id} step={step} active={active} />;
					})}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

function ToolTimelineStep({ step, active }: { readonly step: TimelineStep; readonly active: boolean }) {
	const [open, setOpen] = useState(false);
	const Icon = useIcon(step.icon);
	const ChevronRight = useIcon("chevron-right");
	const expandable = Boolean(step.details);
	const rowClassName = cn(
		"flex min-w-0 items-center gap-2 text-start text-[13.5px] text-foreground/55 outline-none",
		expandable && "transition-colors hover:text-foreground/90",
	);
	const chevronClassName = cn(
		"ms-auto inline-flex shrink-0 opacity-60 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
		open && "rotate-90",
	);
	const row = (
		<>
			<Icon size={14} strokeWidth={1.5} className="shrink-0 text-foreground/35" />
			<ShimmerLabel active={active} className="relative min-w-0 truncate leading-none">
				{step.verb}
			</ShimmerLabel>
			{step.chip ? (
				<span className="max-w-48 truncate rounded-md bg-foreground/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-foreground/70">
					{step.chip}
				</span>
			) : null}
			{expandable ? (
				<span className={chevronClassName}>
					<ChevronRight size={14} strokeWidth={1.5} />
				</span>
			) : null}
		</>
	);

	if (!expandable) {
		return <div className={rowClassName}>{row}</div>;
	}

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<CollapsibleTrigger className={rowClassName}>{row}</CollapsibleTrigger>
			<CollapsibleContent className={cn(collapsePanel, "outline-none")}>
				<pre className="mt-2 max-h-64 overflow-auto rounded-md bg-foreground/[0.06] px-2 py-1.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-foreground/70">
					{step.details}
				</pre>
			</CollapsibleContent>
		</Collapsible>
	);
}
