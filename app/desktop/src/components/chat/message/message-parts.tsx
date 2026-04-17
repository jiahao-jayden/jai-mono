import { motion } from "motion/react";
import { AlertCircleIcon } from "lucide-react";
import { TextShimmer } from "../../motion-primitives/text-shimmer";
import { MessageAssistant } from "./message-assistant";

export function StreamingPlaceholder() {
	return (
		<MessageAssistant>
			<motion.div
				className="py-2"
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				transition={{ duration: 0.2 }}
			>
				<TextShimmer className="text-sm font-sans" duration={1.5}>
					思考中...
				</TextShimmer>
			</motion.div>
		</MessageAssistant>
	);
}

export function ErrorBlock({ children }: { children: React.ReactNode }) {
	return (
		<motion.div
			role="alert"
			initial={{ opacity: 0, y: -2 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.25, ease: "easeOut" }}
			className="relative flex items-start gap-2.5 overflow-hidden rounded-lg border border-border/70 bg-card/60 py-2.5 pl-3.5 pr-3 text-[13px] leading-relaxed text-foreground/85 shadow-xs"
		>
			<span
				aria-hidden
				className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-destructive/70"
			/>
			<AlertCircleIcon className="mt-0.5 size-3.5 shrink-0 text-destructive/80" />
			<span className="min-w-0 flex-1 wrap-break-word">{children}</span>
		</motion.div>
	);
}

export function TypingIndicator() {
	return (
		<motion.div
			className="py-2"
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={{ duration: 0.2 }}
		>
			<TextShimmer className="text-sm font-sans" duration={1.5}>
				思考中...
			</TextShimmer>
		</motion.div>
	);
}
