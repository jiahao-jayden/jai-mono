import { useRef } from "react";
import type { useGatewayChat } from "@/hooks/use-gateway-chat";
import { useCursorEffect } from "@/hooks/use-cursor-effect";
import { cn } from "@/lib/utils";
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
} from "../ai-elements/conversation";
import { MessageResponse } from "../ai-elements/message";
import {
	PromptInput,
	PromptInputBody,
	PromptInputFooter,
	type PromptInputMessage,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
} from "../ai-elements/prompt-input";
import { ChatHeader } from "./chat-header";
import { MessageAssistant } from "./message-assistant";
import { MessageToolCall } from "./message-tool-call";
import { MessageUser } from "./message-user";
import { ModelSelector } from "./model-selector";

export function ChatArea({ chat }: { chat: ReturnType<typeof useGatewayChat> }) {
	const { wrapperRef, cursorRef, resetCursor, handlers } = useCursorEffect();
	const { messages, sendMessage, status, stop, availableModels, currentModelId, setModel } = chat;

	// Track message timestamps keyed by message ID
	const timestampsRef = useRef<Map<string, Date>>(new Map());
	const prevCountRef = useRef(0);

	if (messages.length > prevCountRef.current) {
		for (let i = prevCountRef.current; i < messages.length; i++) {
			const msg = messages[i];
			if (!timestampsRef.current.has(msg.id)) {
				timestampsRef.current.set(msg.id, new Date());
			}
		}
		prevCountRef.current = messages.length;
	}

	const handleSubmit = (message: PromptInputMessage) => {
		if (!message.text.trim()) return;
		sendMessage(message.text);
		resetCursor();
	};

	return (
		<main
			className={cn("flex-1 flex flex-col h-full relative overflow-hidden border border-border/50")}
		>
			<ChatHeader status={status} />

			<Conversation className="flex-1">
				<ConversationContent className="max-w-3xl mx-auto w-full pb-32 gap-5">
					{messages.length === 0 ? (
						<ConversationEmptyState />
					) : (
						messages.map((message) => {
							if (message.role === "user") {
								const text = message.parts.find((p) => p.type === "text")?.text ?? "";
								return <MessageUser key={message.id}>{text}</MessageUser>;
							}

							return (
								<MessageAssistant key={message.id}>
									{message.parts.map((part, i) => {
										if (part.type === "text" && part.text) {
											return (
												<MessageResponse key={`${message.id}-${i}`}>{part.text}</MessageResponse>
											);
										}
										if (part.type === "tool_call" && part.toolCall) {
											return (
												<MessageToolCall
													key={`${message.id}-${i}`}
													title={part.toolCall.name}
													status={part.toolCall.status ?? "pending"}
												/>
											);
										}
										return null;
									})}
								</MessageAssistant>
							);
						})
					)}
				</ConversationContent>
			</Conversation>

			<div className="absolute bottom-0 w-full pt-10 pb-4 px-4 md:px-24 bg-linear-to-t from-background via-background/95 to-transparent pointer-events-none">
				<div className="max-w-3xl mx-auto pointer-events-auto">
					<PromptInput onSubmit={handleSubmit}>
						<PromptInputBody>
							<div ref={wrapperRef} className="relative w-full">
								<div
									ref={cursorRef}
									className="absolute w-0.75 rounded-full bg-primary opacity-0 z-20 pointer-events-none"
									style={{ height: "18px", top: "12px", left: "12px" }}
								/>
								<PromptInputTextarea
									placeholder="Type a message or command..."
									style={{ caretColor: "transparent" }}
									{...handlers}
								/>
							</div>
						</PromptInputBody>
						<PromptInputFooter>
							<PromptInputTools>
								<ModelSelector
									models={availableModels}
									currentModelId={currentModelId}
									onSelect={setModel}
								/>
							</PromptInputTools>
							<PromptInputSubmit status={status} onStop={stop} />
						</PromptInputFooter>
					</PromptInput>

					<p className="text-center text-[11px] text-muted-foreground/50 mt-2.5 select-none">
						JAI can make mistakes. Verify important information.
					</p>
				</div>
			</div>
		</main>
	);
}
