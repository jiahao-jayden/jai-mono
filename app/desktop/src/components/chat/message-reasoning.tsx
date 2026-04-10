import { ChevronRightIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface MessageReasoningProps {
	children: string;
	streaming?: boolean;
}

export function MessageReasoning({ children, streaming }: MessageReasoningProps) {
	const [open, setOpen] = useState(false);

	return (
		<div className="w-full">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className={cn(
					"inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors py-0.5 rounded",
					streaming && "text-muted-foreground/70",
				)}
			>
				<SparklesIcon className={cn("size-3", streaming && "animate-pulse text-amber-400/70")} />
				<span>{streaming ? "思考中…" : "思考过程"}</span>
				<ChevronRightIcon
					className={cn(
						"size-2.5 transition-transform duration-200",
						open && "rotate-90",
					)}
				/>
			</button>
			<div
				className={cn(
					"grid transition-[grid-template-rows] duration-200 ease-out",
					open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}
			>
				<div className="overflow-hidden">
					<div className="mt-1 pl-4 border-l border-muted-foreground/8 text-[11px] text-muted-foreground/40 leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto">
						{children}
					</div>
				</div>
			</div>
		</div>
	);
}
