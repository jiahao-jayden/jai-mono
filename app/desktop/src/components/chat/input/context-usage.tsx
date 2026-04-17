import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatStore } from "@/stores/chat";

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(n);
}

const SIZE = 18;
const STROKE = 2;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ContextUsageRing() {
	const contextTokens = useChatStore((s) => s.contextTokens);
	const contextWindow = useChatStore((s) => s.contextWindow);

	if (!contextWindow) return null;

	const ratio = Math.min(contextTokens / contextWindow, 1);
	const percent = Math.round(ratio * 100);
	const offset = CIRCUMFERENCE * (1 - ratio);

	const strokeColor =
		ratio > 0.75 ? "var(--destructive)" : ratio > 0.5 ? "oklch(0.75 0.15 75)" : "var(--muted-foreground)";

	return (
		<TooltipProvider delayDuration={200}>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground/70 hover:bg-accent hover:text-foreground transition-colors"
					>
						<svg
							width={SIZE}
							height={SIZE}
							viewBox={`0 0 ${SIZE} ${SIZE}`}
							className="rotate-[-90deg]"
							aria-hidden="true"
							focusable="false"
						>
							<circle
								cx={SIZE / 2}
								cy={SIZE / 2}
								r={RADIUS}
								fill="none"
								stroke="currentColor"
								strokeWidth={STROKE}
								opacity={0.15}
							/>
							{contextTokens > 0 && (
								<circle
									cx={SIZE / 2}
									cy={SIZE / 2}
									r={RADIUS}
									fill="none"
									stroke={strokeColor}
									strokeWidth={STROKE}
									strokeLinecap="round"
									strokeDasharray={CIRCUMFERENCE}
									strokeDashoffset={offset}
									style={{ transition: "stroke-dashoffset 0.4s cubic-bezier(0.16, 1, 0.3, 1), stroke 0.3s" }}
								/>
							)}
						</svg>
					</button>
				</TooltipTrigger>
				<TooltipContent side="top" className="text-xs tabular-nums">
					<span>
						{formatTokens(contextTokens)} / {formatTokens(contextWindow)} tokens
					</span>
					<span className="text-background/60">{percent}%</span>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
