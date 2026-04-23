import { motion } from "motion/react";
import { Message, MessageContent } from "../../ai-elements/message";

interface MessageAssistantProps {
	children: React.ReactNode;
}

export function MessageAssistant({ children }: MessageAssistantProps) {
	return (
		<motion.div
			className="flex gap-3 w-full"
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ type: "spring", stiffness: 300, damping: 24 }}
		>
			<div className="flex-1 min-w-0 flex flex-col gap-1.5">
				<Message from="assistant" className="w-full max-w-full">
					<MessageContent className="w-full max-w-full text-[14px] leading-relaxed text-foreground/90! font-sans">
						{children}
					</MessageContent>
				</Message>
			</div>
		</motion.div>
	);
}
