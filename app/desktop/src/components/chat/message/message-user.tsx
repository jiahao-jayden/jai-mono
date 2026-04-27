import { motion } from "motion/react";
import type { ChatAttachment } from "@/types/chat";
import { Message, MessageContent } from "../../ai-elements/message";
import { AttachmentList } from "./attachment-preview";

interface MessageUserProps {
	children: React.ReactNode;
	attachments?: ChatAttachment[];
	/** Exposed on the DOM so Conversation can pin this message to the viewport top on send. */
	messageId?: string;
	/** When set, render a small chip indicating which skill/command was loaded into context. */
	commandName?: string | null;
}

export function MessageUser({ children, attachments, messageId, commandName }: MessageUserProps) {
	const hasAttachments = attachments && attachments.length > 0;
	const hasText = typeof children === "string" ? children.trim().length > 0 : children != null;
	return (
		<motion.div
			data-message-id={messageId}
			data-role="user"
			className="flex flex-col items-end gap-1.5 w-full"
			initial={{ opacity: 0, x: 12 }}
			animate={{ opacity: 1, x: 0 }}
			transition={{ type: "spring", stiffness: 300, damping: 24 }}
		>
			{commandName && (
				<div className="flex justify-end max-w-[75%]">
					<span
						className="inline-flex items-center gap-1 rounded-full bg-primary-2/8 px-2 py-0.5 text-[10.5px] font-medium tracking-wide text-primary-2/85 ring-1 ring-primary-2/15"
						title={`Skill loaded: ${commandName}`}
					>
						<span className="size-1 rounded-full bg-primary-2/65" aria-hidden />
						{commandName}
					</span>
				</div>
			)}
			{hasAttachments && (
				<div className="flex justify-end max-w-[75%]">
					<AttachmentList attachments={attachments} />
				</div>
			)}
			{hasText && (
				<Message from="user" className="max-w-[75%]">
					<MessageContent className="rounded-2xl rounded-tr-md text-[14px] leading-relaxed text-foreground/70!">
						{children}
					</MessageContent>
				</Message>
			)}
		</motion.div>
	);
}
