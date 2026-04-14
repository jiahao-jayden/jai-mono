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
		<div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
			<AlertCircleIcon className="size-4 mt-0.5 shrink-0" />
			<span>{children}</span>
		</div>
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
