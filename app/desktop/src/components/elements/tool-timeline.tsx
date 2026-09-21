"use client";

import { type ReactNode, useEffect, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { type IconName, useIcon } from "@/lib/icon-context";
import { cn } from "cn";
import type { DesktopWebSearchResult } from "../../../shared/desktop-rpc";
import { paper, ShimmerLabel } from "./surfaces";
import { WebSearchResults } from "./web-search-results";

export interface TimelineStep {
	id: string;
	kind?: "activity" | "narration";
	title: string;
	summary?: string;
	density?: "compact" | "default";
	icon: IconName;
	details?: string;
	webSearchResults?: readonly DesktopWebSearchResult[];
	active?: boolean;
	/** Replaces the icon glyph, e.g. a subagent's face. */
	avatar?: ReactNode;
	/** The row is a plain button firing this instead of expanding details. */
	onSelect?: () => void;
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

const UNANIMATED_TIMELINE_THRESHOLD = 20;

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
	const headerClassName = "inline-flex items-center gap-1 pb-2 text-left text-[14px] text-foreground/55";
	const stepsClassName = "flex flex-col gap-2.5 ps-4 py-2.5";
	const timelineSteps = (
		<div className={stepsClassName}>
			{steps.map((step) => (
				<ToolTimelineStep key={step.id} step={step} active={false} />
			))}
		</div>
	);

	if (streaming) {
		return (
			<div className={cn("w-full max-w-sm", className)}>
				<div className={headerClassName}>
					<ShimmerLabel active className="relative inline-block text-start tabular-nums leading-none">
						{activeLabel}
					</ShimmerLabel>
				</div>
				<div className={stepsClassName}>
					{steps.map((step, index) => (
						<ToolTimelineStep key={step.id} step={step} active={step.active ?? index === steps.length - 1} />
					))}
				</div>
			</div>
		);
	}

	return (
		<Collapsible
			data-slot="tool-timeline"
			open={open}
			onOpenChange={onOpenChange}
			className={cn("w-full max-w-sm", className)}
		>
			<CollapsibleTrigger className="group/trigger inline-flex items-center gap-1 rounded-md pb-2 text-left text-[14px] text-foreground/55 outline-none transition-colors hover:text-foreground/90">
				<ShimmerLabel active={false} className="relative inline-block text-start tabular-nums leading-none">
					{restingLabel}
				</ShimmerLabel>
				<span className={chevronClassName}>
					<ChevronRight size={14} strokeWidth={1.5} />
				</span>
			</CollapsibleTrigger>
			{steps.length >= UNANIMATED_TIMELINE_THRESHOLD ? (
				open ? timelineSteps : null
			) : (
				<CollapsibleContent keepMounted={false} className="outline-none">
					{timelineSteps}
				</CollapsibleContent>
			)}
		</Collapsible>
	);
}

function ToolTimelineStep({ step, active }: { readonly step: TimelineStep; readonly active: boolean }) {
	const hasWebSearchResults = step.webSearchResults !== undefined;
	const [open, setOpen] = useState(hasWebSearchResults);
	const Icon = useIcon(step.icon);
	const ChevronRight = useIcon("chevron-right");
	const selectable = step.onSelect !== undefined;
	const expandable = !selectable && Boolean(step.details || hasWebSearchResults);

	useEffect(() => {
		if (hasWebSearchResults) setOpen(true);
	}, [hasWebSearchResults]);
	const density = step.density ?? "compact";
	const containmentClassName = "[content-visibility:auto] [contain-intrinsic-size:auto_24px]";
	const rowClassName = cn(
		"flex min-w-0 items-center text-start text-foreground/55 outline-none",
		density === "compact" ? "gap-2 text-[13px] leading-5" : "gap-2 text-[14px] leading-5",
		(expandable || selectable) && "transition-colors hover:text-foreground/90",
	);
	const chevronClassName = cn(
		"ms-auto inline-flex shrink-0 opacity-60 transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
		open && "rotate-90",
	);
	const detailsRows = Math.min(12, Math.max(3, step.details?.split("\n").length ?? 3));
	if (step.kind === "narration") {
		return (
			<div className={cn("min-w-0 text-start text-[13px] leading-5 text-foreground/85", containmentClassName)}>
				<span className="min-w-0 whitespace-pre-wrap">{step.title}</span>
			</div>
		);
	}
	const row = (
		<>
			<span className="flex size-5 shrink-0 items-center justify-center">
				{step.avatar ?? <Icon size={14} strokeWidth={1.5} className="text-foreground/35" />}
			</span>
			<ShimmerLabel active={active} className="relative min-w-0 truncate leading-none">
				{step.title}
			</ShimmerLabel>
			{step.summary ? (
				<span className="max-w-56 truncate rounded-md bg-foreground/6 px-1.5 py-0.5 font-mono text-[11px] leading-4 text-foreground/70">
					{step.summary}
				</span>
			) : null}
			{expandable || selectable ? (
				<span className={chevronClassName}>
					<ChevronRight size={14} strokeWidth={1.5} />
				</span>
			) : null}
		</>
	);

	if (selectable) {
		return (
			<button
				type="button"
				onClick={step.onSelect}
				className={cn(rowClassName, containmentClassName, "max-w-full cursor-pointer self-start")}
			>
				{row}
			</button>
		);
	}

	if (!expandable) {
		return <div className={cn(rowClassName, containmentClassName)}>{row}</div>;
	}

	return (
		<Collapsible open={open} onOpenChange={setOpen} className={containmentClassName}>
			<CollapsibleTrigger className={rowClassName}>{row}</CollapsibleTrigger>
			<CollapsibleContent keepMounted={false} className="mt-2 contain-[paint] outline-none">
				{step.webSearchResults ? (
					<div className={cn(paper, "max-h-52 overflow-y-auto rounded-lg p-2")}>
						<WebSearchResults results={step.webSearchResults} />
					</div>
				) : (
					<textarea
						aria-label={step.title}
						className={cn(
							paper,
							"w-full resize-none overflow-auto rounded-lg px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-foreground/70 outline-none focus-visible:ring-1 focus-visible:ring-ring",
						)}
						readOnly
						rows={detailsRows}
						spellCheck={false}
						value={step.details}
						wrap="off"
					/>
				)}
			</CollapsibleContent>
		</Collapsible>
	);
}
