import { ArrowUp02Icon, Link02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { PaperclipIcon, SquareIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { nanoid } from "nanoid";
import { useState } from "react";
import { useCursorEffect } from "@/hooks/use-cursor-effect";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat";
import type { ChatAttachment } from "@/types/chat";
import {
	PromptInput,
	PromptInputBody,
	PromptInputButton,
	PromptInputFooter,
	type PromptInputMessage,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
	usePromptInputAttachments,
} from "../../ai-elements/prompt-input";
import { Spinner } from "../../ui/spinner";
import { AttachmentList } from "../message/attachment-preview";
import { ContextUsageRing } from "./context-usage";
import { ModelSelector } from "./model-selector";
import { createPastedTextAttachment } from "./paste-attachment";
import { ReasoningEffortSelector } from "./reasoning-effort-selector";

function InputAttachments() {
	const { files, remove } = usePromptInputAttachments();
	if (files.length === 0) return null;

	const attachments: ChatAttachment[] = files.map((f) => ({
		id: f.id,
		filename: f.filename ?? "file",
		mimeType: f.mediaType ?? "application/octet-stream",
		size: 0,
		previewUrl: f.url,
	}));

	return (
		<div className="w-full px-3 pt-2">
			<AttachmentList attachments={attachments} onRemove={remove} />
		</div>
	);
}

function AttachButton() {
	const { openFileDialog } = usePromptInputAttachments();
	return (
		<PromptInputButton
			onClick={openFileDialog}
			title="Attach files"
			className="text-muted-foreground hover:text-foreground"
		>
			<HugeiconsIcon icon={Link02Icon} size={16} strokeWidth={1.8} />
		</PromptInputButton>
	);
}

export function ChatInput({ className }: { className?: string }) {
	const { wrapperRef, cursorRef, resetCursor, handlers } = useCursorEffect();
	const { sendMessage, status, stop, availableModels, currentModelId, setModel, reasoningEffort, setReasoningEffort } =
		useChatStore();
	const [inputValue, setInputValue] = useState("");

	const isEmpty = inputValue.trim().length === 0;
	const isGenerating = status === "submitted" || status === "streaming";
	const currentModel = availableModels.find((m) => m.id === currentModelId);
	const supportsReasoning = currentModel?.capabilities?.reasoning === true;

	const handleSubmit = (message: PromptInputMessage) => {
		if (!message.text.trim() && message.files.length === 0) return;

		let attachments: ChatAttachment[] | undefined;
		if (message.files.length > 0) {
			attachments = message.files.map((f) => ({
				id: nanoid(),
				filename: f.filename ?? "file",
				mimeType: f.mediaType ?? "application/octet-stream",
				size: 0,
				dataUrl: f.url,
				previewUrl: f.url,
			}));
		}

		sendMessage(message.text, attachments);
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
			<PromptInput onSubmit={handleSubmit} maxFileSize={20 * 1024 * 1024} maxFiles={10}>
				<PromptInputBody>
					<InputAttachments />
					<div ref={wrapperRef} className="relative w-full">
						<div
							ref={cursorRef}
							className="absolute w-0.5 rounded-full bg-primary-2/80 opacity-0 z-20 pointer-events-none"
							style={{ height: "18px", top: "12px", left: "12px" }}
						/>
						<PromptInputTextarea
							placeholder="Type a message or command..."
							style={{ caretColor: "transparent" }}
							transformPastedTextToFile={createPastedTextAttachment}
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
						<AttachButton />
						<ModelSelector models={availableModels} currentModelId={currentModelId} onSelect={setModel} />
						{supportsReasoning && (
							<ReasoningEffortSelector value={reasoningEffort} onChange={setReasoningEffort} />
						)}
						<ContextUsageRing />
					</PromptInputTools>
					<PromptInputSubmit
						status={status}
						onStop={stop}
						className={cn(
							"rounded-full",
							isEmpty && !isGenerating ? "bg-muted text-muted-foreground" : "bg-primary-2",
						)}
					>
						<AnimatePresence mode="wait" initial={false}>
							{status === "submitted" ? (
								<motion.span
									key="spinner"
									initial={{ opacity: 0, scale: 0.5 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0, scale: 0.5 }}
									transition={{ duration: 0.15 }}
									className="flex items-center justify-center"
								>
									<Spinner />
								</motion.span>
							) : status === "streaming" ? (
								<motion.span
									key="stop"
									initial={{ opacity: 0, scale: 0.5 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0, scale: 0.5 }}
									transition={{ duration: 0.15 }}
									className="flex items-center justify-center"
								>
									<SquareIcon className="size-4" />
								</motion.span>
							) : (
								<motion.span
									key="send"
									initial={{ opacity: 0, scale: 0.5 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0, scale: 0.5 }}
									transition={{ duration: 0.15 }}
									className="flex items-center justify-center"
								>
									<HugeiconsIcon icon={ArrowUp02Icon} size={24} strokeWidth={2} />
								</motion.span>
							)}
						</AnimatePresence>
					</PromptInputSubmit>
				</PromptInputFooter>
			</PromptInput>
		</div>
	);
}
