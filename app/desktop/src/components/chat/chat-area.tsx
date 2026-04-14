import { AlertCircleIcon, ArrowUpIcon, SquareIcon } from "lucide-react";
import { useState } from "react";
import panda_logo_2 from "@/assets/icons/chat-area/panda-2.svg";
import { useCursorEffect } from "@/hooks/use-cursor-effect";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat";
import type { ChatMessagePart } from "@/types/chat";
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
import { MessageReasoning } from "./message-reasoning";
import { MessageUser } from "./message-user";
import { ModelSelector } from "./model-selector";
import { ReasoningEffortSelector } from "./reasoning-effort-selector";
import { ToolCallGroup } from "./tool-call-group";

function ChatInput({ className }: { className?: string }) {
	const { wrapperRef, cursorRef, resetCursor, handlers } = useCursorEffect();
	const { sendMessage, status, stop, availableModels, currentModelId, setModel, reasoningEffort, setReasoningEffort } =
		useChatStore();
	const [inputValue, setInputValue] = useState("");

	const isEmpty = inputValue.trim().length === 0;
	const isGenerating = status === "submitted" || status === "streaming";
	const currentModel = availableModels.find((m) => m.id === currentModelId);
	const supportsReasoning = currentModel?.capabilities?.reasoning === true;

	const handleSubmit = (message: PromptInputMessage) => {
		if (!message.text.trim()) return;
		sendMessage(message.text);
		setInputValue("");
		resetCursor();
	};

	return (
		<div
			className={cn(
				"max-w-3xl w-full mx-auto **:data-[slot=input-group]:rounded-lg! **:data-[slot=input-group]:border-primary/10 **:data-[slot=input-group]:transition-[border-color] **:data-[slot=input-group]:duration-200 [&_[data-slot=input-group]:hover]:border-primary/20 [&_[data-slot=input-group]:focus-within]:border-primary/20 [&_[data-slot=input-group]:focus-within]:ring-0 **:data-[slot=input-group]:bg-card!",
				className,
			)}
		>
			<PromptInput onSubmit={handleSubmit}>
				<PromptInputBody>
					<div ref={wrapperRef} className="relative w-full">
						<div
							ref={cursorRef}
							className="absolute w-0.5 rounded-full bg-primary-2/80 opacity-0 z-20 pointer-events-none"
							style={{ height: "18px", top: "12px", left: "12px" }}
						/>
						<PromptInputTextarea
							placeholder="Type a message or command..."
							style={{ caretColor: "transparent" }}
							{...handlers}
							onChange={(e) => {
								handlers.onChange();
								setInputValue(e.target.value);
							}}
						/>
					</div>
				</PromptInputBody>
				<PromptInputFooter>
					<PromptInputTools>
						<ModelSelector models={availableModels} currentModelId={currentModelId} onSelect={setModel} />
						{supportsReasoning && (
							<ReasoningEffortSelector value={reasoningEffort} onChange={setReasoningEffort} />
						)}
					</PromptInputTools>
					<PromptInputSubmit
						status={status}
						onStop={stop}
						className={cn(
							"rounded-full",
							isEmpty && !isGenerating ? "bg-muted text-muted-foreground" : "bg-primary-2",
						)}
					>
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
	);
}

export function ChatArea() {
	const { messages, status } = useChatStore();

	return (
		<main className={cn("flex-1 flex flex-col h-full relative overflow-hidden border border-border/50")}>
			<ChatHeader status={status} />

			{messages.length === 0 ? (
				<div className="flex-1 flex flex-col items-center justify-center px-4">
					<div className="flex flex-col items-center justify-center gap-4 my-10">
						<img src={panda_logo_2} alt="JAI" className="w-64 object-contain" />
						<p className="text-center text-xl">Hi! Jayden, JAI is here to help you.</p>
					</div>
					<ChatInput className="**:data-[slot=input-group]:rounded-xl" />
				</div>
			) : (
				<>
					<Conversation className="flex-1">
						<ConversationContent className="max-w-3xl mx-auto w-full pb-1 gap-1">
							{messages.map((message, msgIdx) => {
								if (message.role === "user") {
									const text = message.parts.find((p) => p.type === "text")?.text ?? "";
									return <MessageUser key={message.id}>{text}</MessageUser>;
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
														<ToolCallGroup
															key={`${message.id}-tg-${seg.tools[0].toolCallId}`}
															tools={seg.tools}
														/>
													);
												}

												const part = seg.part;
												const partIdx = seg.index;
												const key = `${message.id}-${partIdx}`;

												if (part.type === "reasoning" && part.text) {
													const isReasoningStreaming =
														isStreaming &&
														partIdx === message.parts.length - 1 &&
														lastPart?.type === "reasoning";
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
							{(status === "submitted" ||
								(status === "streaming" && messages[messages.length - 1]?.role === "user")) && (
								<StreamingPlaceholder />
							)}
						</ConversationContent>
					</Conversation>

					<div className="px-4 pb-4">
						<ChatInput className="**:data-[slot=input-group]:rounded-2xl" />
					</div>
				</>
			)}
		</main>
	);
}

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

function StreamingPlaceholder() {
	return (
		<MessageAssistant>
			<div className="flex items-center gap-2 py-2">
				<span className="size-2 rounded-full bg-foreground/30 animate-[bounce_1.4s_ease-in-out_infinite]" />
				<span className="size-2 rounded-full bg-foreground/30 animate-[bounce_1.4s_ease-in-out_0.2s_infinite]" />
				<span className="size-2 rounded-full bg-foreground/30 animate-[bounce_1.4s_ease-in-out_0.4s_infinite]" />
			</div>
		</MessageAssistant>
	);
}

function ErrorBlock({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
			<AlertCircleIcon className="size-4 mt-0.5 shrink-0" />
			<span>{children}</span>
		</div>
	);
}

function TypingIndicator() {
	return (
		<div className="flex items-center gap-2 py-2">
			<span className="size-2 rounded-full bg-foreground/30 animate-[bounce_1.4s_ease-in-out_infinite]" />
			<span className="size-2 rounded-full bg-foreground/30 animate-[bounce_1.4s_ease-in-out_0.2s_infinite]" />
			<span className="size-2 rounded-full bg-foreground/30 animate-[bounce_1.4s_ease-in-out_0.4s_infinite]" />
		</div>
	);
}
