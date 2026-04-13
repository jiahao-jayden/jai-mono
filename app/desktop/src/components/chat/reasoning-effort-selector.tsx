import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const EFFORT_LEVELS = [
	{ value: "low", label: "Low", bars: 1 },
	{ value: "medium", label: "Med", bars: 2 },
	{ value: "high", label: "High", bars: 3 },
	{ value: "max", label: "Max", bars: 4 },
] as const;

function EffortBars({ count, total = 4, className }: { count: number; total?: number; className?: string }) {
	const bars = ["h-1.5", "h-2", "h-2.5", "h-3"];
	return (
		<div className={cn("flex items-end gap-px", className)}>
			{bars.slice(0, total).map((h, i) => (
				<div
					key={h}
					className={cn("w-0.75 rounded-full transition-colors", h, i < count ? "bg-current" : "bg-current/20")}
				/>
			))}
		</div>
	);
}

interface ReasoningEffortSelectorProps {
	value: string | null;
	onChange: (value: string | null) => void;
}

export function ReasoningEffortSelector({ value, onChange }: ReasoningEffortSelectorProps) {
	const [open, setOpen] = useState(false);
	const current = EFFORT_LEVELS.find((l) => l.value === value);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<PopoverTrigger asChild>
							<button
								type="button"
								className={cn(
									"inline-flex items-center gap-1.5 text-xs px-1.5 py-1 rounded-md transition-colors",
									value
										? "text-foreground/70 hover:text-foreground hover:bg-accent"
										: "text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent",
								)}
							>
								<EffortBars count={current?.bars ?? 0} />
								{current && <span className="text-[11px] leading-none">{current.label}</span>}
							</button>
						</PopoverTrigger>
					</TooltipTrigger>
					<TooltipContent side="top">Reasoning effort</TooltipContent>
				</Tooltip>
			</TooltipProvider>

			<PopoverContent align="start" side="top" sideOffset={8} className="w-auto p-1 rounded-md!">
				<div className="flex items-center gap-0.5">
					<button
						type="button"
						onClick={() => {
							onChange(null);
							setOpen(false);
						}}
						className={cn(
							"px-2 py-1 rounded-md text-[11px] transition-colors",
							!value
								? "bg-accent font-medium text-foreground"
								: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
						)}
					>
						Auto
					</button>
					{EFFORT_LEVELS.map((level) => (
						<button
							key={level.value}
							type="button"
							onClick={() => {
								onChange(level.value);
								setOpen(false);
							}}
							className={cn(
								"flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] transition-colors",
								value === level.value
									? "bg-accent font-medium text-foreground"
									: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
							)}
						>
							<EffortBars count={level.bars} className="opacity-60" />
							{level.label}
						</button>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}
