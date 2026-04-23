import { cn } from "@/lib/utils";
import type { ChatItem, ChatStatus } from "@/types/chat";
import { MessageResponse } from "../ai-elements/message";
import { CompactionDivider } from "./compaction-divider";
import { MessageAssistant } from "./message/message-assistant";
import { ErrorBlock, StreamingPlaceholder, TypingIndicator } from "./message/message-parts";
import { MessageReasoning } from "./message/message-reasoning";
import { MessageUser } from "./message/message-user";
import { ToolCallRow } from "./message/tool-call-row";

interface MessageListProps {
	messages: ChatItem[];
	status: ChatStatus;
}

function findLastMessageIndex(items: ChatItem[]): number {
	for (let i = items.length - 1; i >= 0; i--) {
		if (items[i].kind === "message") return i;
	}
	return -1;
}

export function MessageList({ messages, status }: MessageListProps) {
	const lastMessageIdx = findLastMessageIndex(messages);
	const lastItem = messages[messages.length - 1];

	return (
		<>
			{messages.map((item, msgIdx) => {
				if (item.kind === "compaction") {
					return <CompactionDivider key={item.id} status={item.status} timestamp={item.timestamp} />;
				}
				const message = item;
				if (message.role === "user") {
					const text = message.parts.find((p) => p.type === "text")?.text ?? "";
					const attachments = message.parts
						.filter((p) => p.type === "attachment" && p.attachment)
						.map((p) => p.attachment!);
					return (
						<MessageUser key={message.id} messageId={message.id} attachments={attachments}>
							{text}
						</MessageUser>
					);
				}

				const isLastAssistant = msgIdx === lastMessageIdx && message.role === "assistant";
				const isStreaming = isLastAssistant && status === "streaming";
				const lastPart = message.parts[message.parts.length - 1];
				const hasNoTextYet = isStreaming && !message.parts.some((p) => p.type === "text");
				const showIndicator =
					isStreaming &&
					(message.parts.length === 0 ||
						(hasNoTextYet &&
							lastPart &&
							(lastPart.type === "reasoning" ||
								(lastPart.type === "tool_call" && lastPart.toolCall?.status === "completed"))));

				return (
					<MessageAssistant key={message.id}>
						<div className="flex flex-col gap-0.5">
							{message.parts.map((part, partIdx) => {
								const key = `${message.id}-${partIdx}`;

								if (part.type === "tool_call" && part.toolCall) {
									return <ToolCallRow key={`${key}-${part.toolCall.toolCallId}`} tool={part.toolCall} />;
								}
								if (part.type === "reasoning" && part.text) {
									const isReasoningStreaming =
										isStreaming && partIdx === message.parts.length - 1 && lastPart?.type === "reasoning";
									return (
										<MessageReasoning key={key} streaming={isReasoningStreaming}>
											{part.text}
										</MessageReasoning>
									);
								}
								if (part.type === "text" && part.text) {
									const isTextTip =
										isStreaming && partIdx === message.parts.length - 1 && lastPart?.type === "text";
									return (
										<MessageResponse key={key} className={cn(isTextTip && "is-streaming-tip")}>
											{part.text}
										</MessageResponse>
									);
								}
								if (part.type === "error" && part.text) {
									return <ErrorBlock key={key}>{part.text}</ErrorBlock>;
								}
								return null;
							})}
							{showIndicator && <TypingIndicator />}
						</div>
					</MessageAssistant>
				);
			})}
			{(status === "submitted" ||
				(status === "streaming" && lastItem?.kind === "message" && lastItem.role === "user") ||
				(status === "streaming" && lastItem?.kind === "compaction")) && <StreamingPlaceholder />}
		</>
	);
}
