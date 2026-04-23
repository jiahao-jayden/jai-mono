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
						<div className="flex flex-col">
							{message.parts.map((part, partIdx) => {
								const key = `${message.id}-${partIdx}`;
								const prev = partIdx > 0 ? message.parts[partIdx - 1] : null;
								// Only one special case: consecutive tool calls form a tight cluster.
								// Everything else gets a uniform breathing gap so vertical rhythm
								// is predictable regardless of what kinds are adjacent.
								const spacing = (() => {
									if (!prev) return "";
									const curIsTool = part.type === "tool_call";
									const prevIsTool = prev.type === "tool_call";
									if (curIsTool && prevIsTool) return "mt-0.5";
									return "mt-2";
								})();

								if (part.type === "tool_call" && part.toolCall) {
									return (
										<div key={`${key}-${part.toolCall.toolCallId}`} className={spacing}>
											<ToolCallRow tool={part.toolCall} />
										</div>
									);
								}
								if (part.type === "reasoning" && part.text) {
									const isReasoningStreaming =
										isStreaming && partIdx === message.parts.length - 1 && lastPart?.type === "reasoning";
									return (
										<div key={key} className={spacing}>
											<MessageReasoning streaming={isReasoningStreaming}>{part.text}</MessageReasoning>
										</div>
									);
								}
								if (part.type === "text" && part.text) {
									const isTextTip =
										isStreaming && partIdx === message.parts.length - 1 && lastPart?.type === "text";
									return (
										<div key={key} className={spacing}>
											<MessageResponse className={cn(isTextTip && "is-streaming-tip")}>
												{part.text}
											</MessageResponse>
										</div>
									);
								}
								if (part.type === "error" && part.text) {
									return (
										<div key={key} className={spacing}>
											<ErrorBlock>{part.text}</ErrorBlock>
										</div>
									);
								}
								return null;
							})}
							{showIndicator && <div className="mt-2.5"><TypingIndicator /></div>}
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
