import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

type ToolCallStatus = "pending" | "running" | "completed" | "error";

interface MessageToolCallProps {
	title: string;
	status?: ToolCallStatus;
	output?: string;
	className?: string;
}

const STATUS_CONFIG: Record<
	string,
	{ label: string; className: string }
> = {
	completed: {
		label: "COMPLETED",
		className: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400",
	},
	running: {
		label: "RUNNING",
		className: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400",
	},
	pending: {
		label: "PENDING",
		className: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
	},
	error: {
		label: "ERROR",
		className: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400",
	},
};

export function MessageToolCall({ title, status, output, className }: MessageToolCallProps) {
	const cfg = status ? STATUS_CONFIG[status] ?? STATUS_CONFIG.pending : STATUS_CONFIG.pending;

	return (
		<div
			className={cn(
				"w-full rounded-xl border border-border/60 bg-card overflow-hidden",
				className,
			)}
		>
			{/* Tool header */}
			<div className="flex items-center gap-3 px-4 py-3">
				<div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950/50 flex items-center justify-center shrink-0">
					<Search className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
				</div>
				<span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
					{title}
				</span>
				<span
					className={cn(
						"text-[10px] font-semibold tracking-wider px-2 py-0.5 rounded",
						cfg.className,
					)}
				>
					{cfg.label}
				</span>
			</div>

			{/* Terminal output */}
			{output && (
				<div className="border-t border-border/40 bg-zinc-950 dark:bg-zinc-950 px-4 py-3 mx-0">
					<pre className="text-[12px] font-mono text-zinc-300 whitespace-pre-wrap leading-relaxed">
						{output}
					</pre>
				</div>
			)}
		</div>
	);
}
