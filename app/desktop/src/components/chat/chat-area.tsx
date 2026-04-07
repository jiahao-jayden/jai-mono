import { useCursorEffect } from "@/hooks/use-cursor-effect";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat";
import { Conversation, ConversationContent } from "../ai-elements/conversation";
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

export function ChatArea() {
	const { wrapperRef, cursorRef, resetCursor, handlers } = useCursorEffect();
	const { messages, sendMessage, status, stop, availableModels, currentModelId, setModel } = useChatStore();

	const handleSubmit = (message: PromptInputMessage) => {
		if (!message.text.trim()) return;
		sendMessage(message.text);
		resetCursor();
	};

	return (
		<main className={cn("flex-1 flex flex-col h-full relative overflow-hidden border border-border/50")}>
			<ChatHeader status={status} />

			<Conversation className="flex-1">
				<ConversationContent className="max-w-3xl mx-auto w-full pb-32 gap-5">
					{messages.map((message) => {
						if (message.role === "user") {
							const text = message.parts.find((p) => p.type === "text")?.text ?? "";
							return <MessageUser key={message.id}>{text}</MessageUser>;
						}

						return (
							<MessageAssistant key={message.id}>
								{message.parts.map((part, i) => {
									const key = `${message.id}-${i}`;
									if (part.type === "text" && part.text) {
										return <MessageResponse key={key}>{part.text}</MessageResponse>;
									}
									if (part.type === "tool_call" && part.toolCall) {
										return (
											<MessageToolCall
												key={key}
												title={part.toolCall.name}
												status={part.toolCall.status ?? "pending"}
											/>
										);
									}
									return null;
								})}
							</MessageAssistant>
						);
					})}
				</ConversationContent>
			</Conversation>

			<div
				className={cn(
					messages.length === 0 && "w-full h-full flex items-center justify-center pt-10 pb-4 px-4",
					messages.length > 0 &&
						"absolute bottom-0 w-full pt-10 pb-4 px-4 bg-linear-to-t from-background via-background/95 to-transparent pointer-events-none",
				)}
			>
				<div className="max-w-3xl w-full mx-auto pointer-events-auto **:data-[slot=input-group]:rounded-2xl **:data-[slot=input-group]:border-primary/10 [&_[data-slot=input-group]:focus-within]:border-primary/20 [&_[data-slot=input-group]:focus-within]:ring-0">
					<PromptInput onSubmit={handleSubmit}>
						<PromptInputBody>
							<div ref={wrapperRef} className="relative w-full">
								<div
									ref={cursorRef}
									className="absolute w-0.5 rounded-full bg-primary-2 opacity-0 z-20 pointer-events-none"
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
								<ModelSelector models={availableModels} currentModelId={currentModelId} onSelect={setModel} />
							</PromptInputTools>
							<PromptInputSubmit status={status} onStop={stop} />
						</PromptInputFooter>
					</PromptInput>
				</div>
			</div>
		</main>
	);
}
