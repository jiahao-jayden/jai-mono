import { ArchiveIcon } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { TextShimmer } from "../motion-primitives/text-shimmer";

interface CompactionDividerProps {
	status: "streaming" | "done";
	timestamp: number;
}

function formatTime(ts: number): string {
	const d = new Date(ts);
	const today = new Date();
	const sameDay = d.toDateString() === today.toDateString();
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	if (sameDay) return `${hh}:${mm}`;
	const mo = String(d.getMonth() + 1).padStart(2, "0");
	const da = String(d.getDate()).padStart(2, "0");
	return `${mo}-${da} ${hh}:${mm}`;
}

/**
 * Marker shown where a slice of earlier conversation was summarized.
 * Two visual states sharing the same layout so framer-motion can morph
 * the streaming pill into the final static divider.
 *
 * Summary contents are intentionally not exposed — users see that a
 * compaction happened but cannot expand it.
 */
export function CompactionDivider({ status, timestamp }: CompactionDividerProps) {
	const streaming = status === "streaming";

	return (
		<div className="flex items-center gap-3 py-2 select-none">
			<div className="h-px flex-1 bg-border/60" />
			<motion.div
				layout
				layoutId={`compaction-${timestamp}`}
				initial={{ opacity: 0, y: 2 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.25, ease: "easeOut" }}
				className={cn(
					"inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40",
					"px-2.5 py-0.5 text-[11px] text-muted-foreground",
				)}
				aria-label={streaming ? "正在总结对话" : "对话已总结"}
				title={streaming ? "正在总结较早的对话内容…" : "较早的对话已总结以节省上下文"}
			>
				<ArchiveIcon
					className={cn("size-3 shrink-0 text-muted-foreground/70", streaming && "animate-pulse text-primary/80")}
				/>
				{streaming ? (
					<TextShimmer as="span" className="text-[11px] font-serif italic" duration={1.4}>
						正在总结对话…
					</TextShimmer>
				) : (
					<span>
						<span className="font-serif italic">对话已总结</span>
						<span className="tabular-nums text-muted-foreground/70"> · {formatTime(timestamp)}</span>
					</span>
				)}
			</motion.div>
			<div className="h-px flex-1 bg-border/60" />
		</div>
	);
}
