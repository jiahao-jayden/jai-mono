import { Message, MessageContent } from "../ai-elements/message";

interface MessageUserProps {
	children: React.ReactNode;
}

export function MessageUser({ children }: MessageUserProps) {
	return (
		<div className="flex flex-col items-end gap-1.5 w-full">
			<Message from="user" className="max-w-[75%]">
				<MessageContent className="rounded-2xl rounded-tr-md text-[14px] leading-relaxed text-foreground/70!">
					{children}
				</MessageContent>
			</Message>
		</div>
	);
}
