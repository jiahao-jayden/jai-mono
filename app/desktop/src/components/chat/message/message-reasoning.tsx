import { IdeaIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface MessageReasoningProps {
	children: string;
	streaming?: boolean;
}

export function MessageReasoning({ children, streaming }: MessageReasoningProps) {
	const [open, setOpen] = useState(Boolean(streaming));
	const lastStreaming = useRef(streaming);

	useEffect(() => {
		if (lastStreaming.current !== streaming) {
			setOpen(Boolean(streaming));
			lastStreaming.current = streaming;
		}
	}, [streaming]);

	return (
		<div className="w-full">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				aria-expanded={open}
				className={cn(
					"group/row flex items-center gap-2 w-full py-1.5 text-left text-[11.5px] leading-none rounded-sm transition-colors cursor-pointer",
					streaming
						? "text-muted-foreground/80 hover:text-foreground/85"
						: "text-muted-foreground/55 hover:text-foreground/75",
				)}
			>
				<HugeiconsIcon
					icon={IdeaIcon}
					size={12}
					strokeWidth={1.75}
					aria-hidden
					className={cn(
						"shrink-0",
						streaming
							? "text-foreground/65 animate-[pulse_1.8s_ease-in-out_infinite]"
							: "text-muted-foreground/40",
					)}
				/>
				<span className="font-medium shrink-0">{streaming ? "思考中" : "思考"}</span>
				<span className="flex-1" />
				<ChevronRightIcon
					aria-hidden
					className={cn(
						"size-2.5 shrink-0 text-muted-foreground/35 transition-[transform,opacity] duration-200 ease-out",
						open
							? "rotate-90 opacity-100"
							: "opacity-0 group-hover/row:opacity-100 group-focus-visible/row:opacity-100",
					)}
				/>
			</button>
			<div
				className={cn(
					"grid transition-[grid-template-rows,opacity] duration-200 ease-out",
					open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
				)}
			>
				<div className="overflow-hidden">
					<div className="mt-0.5 mb-1 ml-5 pl-3 border-l border-muted-foreground/12 text-[11.5px] text-muted-foreground/55 leading-relaxed whitespace-pre-wrap wrap-break-word max-h-60 overflow-y-auto">
						{children}
					</div>
				</div>
			</div>
		</div>
	);
}
