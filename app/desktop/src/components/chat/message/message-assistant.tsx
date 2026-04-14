import { Message, MessageContent } from "../../ai-elements/message";

interface MessageAssistantProps {
	children: React.ReactNode;
}

export function MessageAssistant({ children }: MessageAssistantProps) {
	return (
		<div className="flex gap-3 w-full">
			<div className="flex-1 min-w-0 flex flex-col gap-1.5">
				<Message from="assistant" className="w-full max-w-full">
					<MessageContent className="text-[14px] leading-relaxed text-foreground/90! font-sans">
						{children}
					</MessageContent>
				</Message>
			</div>
		</div>
	);
}
