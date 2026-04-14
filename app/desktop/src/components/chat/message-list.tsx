import type { ChatMessage, ChatMessagePart, ChatStatus } from "@/types/chat";
import { MessageResponse } from "../ai-elements/message";
import { MessageAssistant } from "./message/message-assistant";
import { ErrorBlock, StreamingPlaceholder, TypingIndicator } from "./message/message-parts";
import { MessageReasoning } from "./message/message-reasoning";
import { MessageUser } from "./message/message-user";
import { ToolCallGroup } from "./message/tool-call-group";

type Segment =
	| { type: "tool_group"; tools: NonNullable<ChatMessagePart["toolCall"]>[] }
	| { type: "single"; part: ChatMessagePart; index: number };

function groupParts(parts: ChatMessagePart[]): Segment[] {
	const segments: Segment[] = [];
	let toolBuf: NonNullable<ChatMessagePart["toolCall"]>[] = [];

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part.type === "tool_call" && part.toolCall) {
			toolBuf.push(part.toolCall);
		} else {
			if (toolBuf.length > 0) {
				segments.push({ type: "tool_group", tools: toolBuf });
				toolBuf = [];
			}
			segments.push({ type: "single", part, index: i });
		}
	}
	if (toolBuf.length > 0) {
		segments.push({ type: "tool_group", tools: toolBuf });
	}
	return segments;
}

interface MessageListProps {
	messages: ChatMessage[];
	status: ChatStatus;
}

export function MessageList({ messages, status }: MessageListProps) {
	return (
		<>
			{messages.map((message, msgIdx) => {
				if (message.role === "user") {
					const text = message.parts.find((p) => p.type === "text")?.text ?? "";
					const attachments = message.parts
						.filter((p) => p.type === "attachment" && p.attachment)
						.map((p) => p.attachment!);
					return (
						<MessageUser key={message.id} attachments={attachments}>
							{text}
						</MessageUser>
					);
				}

				const isLastAssistant = msgIdx === messages.length - 1 && message.role === "assistant";
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

				const segments = groupParts(message.parts);

				return (
					<MessageAssistant key={message.id}>
						<div className="flex flex-col gap-0.5">
							{segments.map((seg) => {
								if (seg.type === "tool_group") {
									return (
										<ToolCallGroup key={`${message.id}-tg-${seg.tools[0].toolCallId}`} tools={seg.tools} />
									);
								}

								const part = seg.part;
								const partIdx = seg.index;
								const key = `${message.id}-${partIdx}`;

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
									return <MessageResponse key={key}>{part.text}</MessageResponse>;
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
			{(status === "submitted" || (status === "streaming" && messages[messages.length - 1]?.role === "user")) && (
				<StreamingPlaceholder />
			)}
		</>
	);
}
