import { ArrowUpIcon, SquareIcon } from "lucide-react";
import panda_logo_1 from "@/assets/icons/chat-area/panda-1.svg";
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
import { Spinner } from "../ui/spinner";
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

			{messages.length === 0 ? (
				<div className="flex-1 flex flex-col items-center justify-center px-4">
					<div className="flex flex-col items-center justify-center gap-4 my-10">
						<img src={panda_logo_1} alt="JAI" className="w-64 object-contain" />
						<p className="text-center text-xl">Hi! Jayden, JAI is here to help you.</p>
					</div>
					<div className="max-w-3xl w-full mx-auto **:data-[slot=input-group]:rounded-2xl **:data-[slot=input-group]:border-primary/10 **:data-[slot=input-group]:transition-[border-color] **:data-[slot=input-group]:duration-200 [&_[data-slot=input-group]:hover]:border-primary/20 [&_[data-slot=input-group]:focus-within]:border-primary/20 [&_[data-slot=input-group]:focus-within]:ring-0">
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
								<PromptInputSubmit status={status} onStop={stop} className="bg-primary-2 rounded-full">
									{status === "submitted" ? (
										<Spinner />
									) : status === "streaming" ? (
										<SquareIcon className="size-4" />
									) : (
										<ArrowUpIcon className="size-4" />
									)}
								</PromptInputSubmit>
							</PromptInputFooter>
						</PromptInput>
					</div>
				</div>
			) : (
				<>
					<Conversation className="flex-1">
						<ConversationContent className="max-w-3xl mx-auto w-full pb-6 gap-5">
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

					<div className="px-4 pb-4">
						<div className="max-w-3xl w-full mx-auto **:data-[slot=input-group]:rounded-2xl **:data-[slot=input-group]:border-primary/10 **:data-[slot=input-group]:transition-[border-color] **:data-[slot=input-group]:duration-200 [&_[data-slot=input-group]:hover]:border-primary/20 [&_[data-slot=input-group]:focus-within]:border-primary/20 [&_[data-slot=input-group]:focus-within]:ring-0">
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
									<PromptInputSubmit status={status} onStop={stop} className="bg-primary-2 rounded-full">
										{status === "submitted" ? (
											<Spinner />
										) : status === "streaming" ? (
											<SquareIcon className="size-4" />
										) : (
											<ArrowUpIcon className="size-4" />
										)}
									</PromptInputSubmit>
								</PromptInputFooter>
							</PromptInput>
						</div>
					</div>
				</>
			)}
		</main>
	);
}
