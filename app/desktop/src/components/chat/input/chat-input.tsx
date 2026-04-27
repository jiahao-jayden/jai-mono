import { ArrowUp02Icon, Link02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { CommandListItem } from "@jayden/jai-gateway";
import { SquareIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { nanoid } from "nanoid";
import {
	type ClipboardEvent,
	type KeyboardEvent,
	useCallback,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
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
	PromptInputProvider,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputTools,
	usePromptInputAttachments,
	usePromptInputController,
} from "../../ai-elements/prompt-input";
import { Spinner } from "../../ui/spinner";
import { AttachmentList } from "../message/attachment-preview";
import { CommandPalette, type CommandPaletteHandle, parseCommandQuery } from "./command-palette";
import { ContextUsageRing } from "./context-usage";
import { ModelSelector } from "./model-selector";
import { combineWithPastedTexts, PASTE_THRESHOLD, type PastedText } from "./paste-attachment";
import { PastedTextChipList } from "./pasted-text-chip";
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

const SLASH_CMD_RE = /(?:^|\s)(\/\S+)/g;

function InputHighlightMirror({ value }: { value: string }) {
	if (!value) return null;

	const parts: React.ReactNode[] = [];
	let lastIndex = 0;

	for (const m of value.matchAll(SLASH_CMD_RE)) {
		const full = m[1];
		const cmdStart = m.index + (m[0].length - full.length);
		if (cmdStart > lastIndex) parts.push(value.slice(lastIndex, cmdStart));
		parts.push(
			<span key={cmdStart} className="text-primary-2">
				{full}
			</span>,
		);
		lastIndex = cmdStart + full.length;
	}
	if (lastIndex < value.length) parts.push(value.slice(lastIndex));

	return (
		<div
			data-slot="input-mirror"
			aria-hidden
			className="pointer-events-none absolute inset-0 z-10 overflow-hidden whitespace-pre-wrap wrap-break-word text-sm text-foreground field-sizing-content max-h-48 min-h-16 px-2.5 py-2"
		>
			{parts}
		</div>
	);
}

export function ChatInput({ className }: { className?: string }) {
	return (
		<PromptInputProvider>
			<ChatInputInner className={className} />
		</PromptInputProvider>
	);
}

function ChatInputInner({ className }: { className?: string }) {
	const { wrapperRef, cursorRef, resetCursor, handlers } = useCursorEffect();
	const {
		sendMessage,
		status,
		stop,
		availableModels,
		currentModelId,
		setModel,
		reasoningEffort,
		setReasoningEffort,
		availableCommands,
	} = useChatStore();
	const controller = usePromptInputController();
	const inputValue = controller.textInput.value;
	const setInputValue = controller.textInput.setInput;

	const isEmpty = inputValue.trim().length === 0;
	const isGenerating = status === "submitted" || status === "streaming";
	const currentModel = availableModels.find((m) => m.id === currentModelId);
	const supportsReasoning = currentModel?.capabilities?.reasoning === true;

	const [cursorPos, setCursorPos] = useState(0);
	const [pastedTexts, setPastedTexts] = useState<PastedText[]>([]);
	const cmdQuery = useMemo(() => parseCommandQuery(inputValue, cursorPos), [inputValue, cursorPos]);
	const paletteVisible = cmdQuery.visible && availableCommands.length > 0 && !isGenerating;
	const paletteRef = useRef<CommandPaletteHandle>(null);
	const pendingCaret = useRef<number | null>(null);

	const handlePaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
		// Files (e.g. images) take priority — let the textarea's built-in
		// handler in PromptInputTextarea convert them into attachments.
		const items = e.clipboardData.items;
		for (const item of items) {
			if (item.kind === "file") return;
		}
		const text = e.clipboardData.getData("text/plain");
		if (text.length <= PASTE_THRESHOLD) return;
		e.preventDefault();
		setPastedTexts((prev) => [...prev, { id: nanoid(), text }]);
	}, []);

	const removePastedText = useCallback((id: string) => {
		setPastedTexts((prev) => prev.filter((p) => p.id !== id));
	}, []);

	const handleCommandSelect = useCallback(
		(cmd: CommandListItem) => {
			const replacement = `/${cmd.fullName} `;
			const before = inputValue.slice(0, cmdQuery.tokenStart);
			const afterCursor = inputValue.slice(cursorPos);
			const next = before + replacement + afterCursor;
			const caretTarget = before.length + replacement.length;
			pendingCaret.current = caretTarget;
			setInputValue(next);
		},
		[setInputValue, inputValue, cmdQuery.tokenStart, cursorPos],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: inputValue triggers caret placement after command insert
	useLayoutEffect(() => {
		if (pendingCaret.current === null) return;
		const target = pendingCaret.current;
		pendingCaret.current = null;
		const ta = wrapperRef.current?.querySelector("textarea");
		if (!ta) return;
		ta.focus();
		ta.setSelectionRange(target, target);
		setCursorPos(target);
		handlers.onChange();
	}, [inputValue, wrapperRef, handlers]);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent<HTMLTextAreaElement>) => {
			if (!paletteVisible) return;
			const handle = paletteRef.current;
			if (!handle?.hasMatches()) return;

			if (e.key === "ArrowDown") {
				e.preventDefault();
				handle.moveActive(1);
				return;
			}
			if (e.key === "ArrowUp") {
				e.preventDefault();
				handle.moveActive(-1);
				return;
			}
			if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
				if (handle.selectActive()) {
					e.preventDefault();
				}
				return;
			}
			if (e.key === "Escape") {
				e.preventDefault();
				setInputValue("");
			}
		},
		[paletteVisible, setInputValue],
	);

	const handleSubmit = (message: PromptInputMessage) => {
		const hasText = message.text.trim().length > 0;
		const hasFiles = message.files.length > 0;
		const hasPasted = pastedTexts.length > 0;
		if (!hasText && !hasFiles && !hasPasted) return;

		let attachments: ChatAttachment[] | undefined;
		if (hasFiles) {
			attachments = message.files.map((f) => ({
				id: nanoid(),
				filename: f.filename ?? "file",
				mimeType: f.mediaType ?? "application/octet-stream",
				size: 0,
				dataUrl: f.url,
				previewUrl: f.url,
			}));
		}

		const finalText = combineWithPastedTexts(message.text, pastedTexts);
		sendMessage(finalText, attachments);
		setPastedTexts([]);
		resetCursor();
	};

	return (
		<div
			className={cn(
				"max-w-3xl w-full mx-auto **:data-[slot=input-group]:rounded-lg! **:data-[slot=input-group]:border-primary/10 **:data-[slot=input-group]:transition-[border-color] **:data-[slot=input-group]:duration-200 [&_[data-slot=input-group]:hover]:border-primary/20 [&_[data-slot=input-group]:focus-within]:border-primary/20 [&_[data-slot=input-group]:focus-within]:ring-0 **:data-[slot=input-group]:bg-card!",
				className,
			)}
		>
			<div className="relative">
				<CommandPalette
					ref={paletteRef}
					commands={availableCommands}
					query={cmdQuery.query}
					visible={paletteVisible}
					onSelect={handleCommandSelect}
				/>
				<PromptInput onSubmit={handleSubmit} maxFileSize={20 * 1024 * 1024} maxFiles={10}>
					<PromptInputBody>
						<InputAttachments />
						{pastedTexts.length > 0 && (
							<div className="w-full px-3 pt-2">
								<PastedTextChipList pastedTexts={pastedTexts} onRemove={removePastedText} />
							</div>
						)}
						<div ref={wrapperRef} className="relative w-full">
							<div
								ref={cursorRef}
								className="absolute w-0.5 rounded-full bg-primary-2/80 opacity-0 z-20 pointer-events-none"
								style={{ height: "18px", top: "12px", left: "12px" }}
							/>
							<InputHighlightMirror value={inputValue} />
							<PromptInputTextarea
								placeholder="Type a message or / for commands…"
								className="text-transparent!"
								style={{ caretColor: "transparent" }}
								onPaste={handlePaste}
								{...handlers}
								onChange={() => {
									handlers.onChange();
									const ta = wrapperRef.current?.querySelector("textarea");
									if (ta) setCursorPos(ta.selectionEnd);
								}}
								onKeyUp={(e) => {
									handlers.onKeyUp(e);
									setCursorPos(e.currentTarget.selectionEnd);
								}}
								onMouseUp={(e) => {
									handlers.onMouseUp();
									setCursorPos(e.currentTarget.selectionEnd);
								}}
								onKeyDown={handleKeyDown}
								onScroll={(e) => {
									handlers.onScroll();
									const mirror = wrapperRef.current?.querySelector<HTMLElement>("[data-slot=input-mirror]");
									if (mirror) mirror.scrollTop = e.currentTarget.scrollTop;
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
		</div>
	);
}
