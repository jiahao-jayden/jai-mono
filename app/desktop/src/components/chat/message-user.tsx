import type { ChatAttachment } from "@/types/chat";
import { Message, MessageContent } from "../ai-elements/message";
import { AttachmentList } from "./attachment-preview";

interface MessageUserProps {
	children: React.ReactNode;
	attachments?: ChatAttachment[];
}

export function MessageUser({ children, attachments }: MessageUserProps) {
	const hasAttachments = attachments && attachments.length > 0;
	return (
		<div className="flex flex-col items-end gap-1.5 w-full">
			{hasAttachments && (
				<div className="flex justify-end max-w-[75%]">
					<AttachmentList attachments={attachments} />
				</div>
			)}
			<Message from="user" className="max-w-[75%]">
				<MessageContent className="rounded-2xl rounded-tr-md text-[14px] leading-relaxed text-foreground/70!">
					{children}
				</MessageContent>
			</Message>
		</div>
	);
}
