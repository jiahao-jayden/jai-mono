import { useEffect, useRef, useState } from "react";
import type { ChatMessageInput, ChatStatus } from "@/hooks/use-chat";
import { desktop } from "@/lib/desktop";
import { useIcons } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { QueuedMessage } from "@/stores/chat";
import type {
	DesktopAgentMode,
	DesktopMessageAttachment,
	DesktopProject,
	DesktopProviderConfigSnapshot,
} from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { InputMessage } from "../../ui/input-message";
import { AgentModeControl } from "./agent-mode-control";
import { ChatMessageQueue } from "./chat-message-queue";
import { MessageAttachmentPicker, MessageAttachmentPreview } from "./message-attachment-picker";
import { ModelSelector } from "./model-selector";
import { ProjectPicker } from "./project-picker";

interface ChatComposerProps {
	value: string;
	onValueChange(value: string): void;
	onSend(message: ChatMessageInput): Promise<boolean>;
	onStop(): Promise<void>;
	status: ChatStatus;
	disabled: boolean;
	queue: readonly QueuedMessage[];
	onEditQueuedMessage(messageId: string): void;
	onRemoveQueuedMessage(messageId: string): void;
	onReorderQueuedMessages(messageIds: readonly string[]): void;
	project?: DesktopProject;
	projects: readonly DesktopProject[];
	projectBusy: boolean;
	projectLoading: boolean;
	projectLoadError: boolean;
	onChooseProject(project: DesktopProject): Promise<void>;
	onAddProject(): Promise<void>;
	onRetryProjects(): void;
	providerConfig?: DesktopProviderConfigSnapshot;
	selectedModelRef: string;
	selectedAgentMode: DesktopAgentMode;
	providerLoading: boolean;
	providerError: boolean;
	onOpenProviderSettings(): void;
	onSelectProviderModel(modelRef: string): void;
	onSelectAgentMode(mode: DesktopAgentMode): void;
	large?: boolean;
	showProjectPicker?: boolean;
}

export function ChatComposer({
	value,
	onValueChange,
	onSend,
	onStop,
	status,
	disabled,
	queue,
	onEditQueuedMessage,
	onRemoveQueuedMessage,
	onReorderQueuedMessages,
	project,
	projects,
	projectBusy,
	projectLoading,
	projectLoadError,
	onChooseProject,
	onAddProject,
	onRetryProjects,
	providerConfig,
	selectedModelRef,
	selectedAgentMode,
	providerLoading,
	providerError,
	onOpenProviderSettings,
	onSelectProviderModel,
	onSelectAgentMode,
	large = false,
	showProjectPicker = true,
}: ChatComposerProps) {
	const icons = useIcons();
	const SendIcon = icons.send;
	const StopIcon = icons.stop;
	const [attachments, setAttachments] = useState<readonly DesktopMessageAttachment[]>([]);
	const [attachmentError, setAttachmentError] = useState<string | undefined>(undefined);
	const attachmentRef = useRef(attachments);
	const hasDraft = value.trim().length > 0;
	const hasAttachments = attachments.length > 0;
	const hasMessageContent = hasDraft || hasAttachments;
	const isStreaming = status === "streaming";
	const isSubmitting = status === "submitted";
	const stopAction = isStreaming && !hasMessageContent;
	const submitLabel = stopAction ? "Stop response" : isStreaming ? "Queue message" : "Send message";
	const composerDisabled = disabled || isSubmitting;
	const submitDisabled = composerDisabled || (!stopAction && !hasMessageContent);
	const submitVariant = stopAction ? "secondary" : "accent";
	const submitClassName = cn(stopAction && "text-primary-2");

	useEffect(() => {
		attachmentRef.current = attachments;
	}, [attachments]);

	useEffect(() => {
		return () => {
			const ids = attachmentRef.current.map((attachment) => attachment.id);
			if (ids.length > 0) void desktop.attachment.release(ids);
		};
	}, []);

	const removeAttachment = (attachment: DesktopMessageAttachment) => {
		setAttachments((current) => current.filter((candidate) => candidate.id !== attachment.id));
		void desktop.attachment.release([attachment.id]);
	};
	const addAttachments = (next: readonly DesktopMessageAttachment[]) => {
		setAttachments((current) => [...current, ...next]);
		setAttachmentError(undefined);
	};
	const submitMessage = async () => {
		if (stopAction) {
			void onStop();
			return;
		}
		const accepted = await onSend({ text: value, mode: selectedAgentMode, attachments });
		if (accepted) {
			setAttachments([]);
			setAttachmentError(undefined);
		}
	};
	const onSubmit = () => void submitMessage();
	const attachmentPreview = hasAttachments ? (
		<MessageAttachmentPreview attachments={attachments} onRemove={removeAttachment} />
	) : undefined;
	const pickerDisabled = composerDisabled || isStreaming;

	return (
		<div>
			<ChatMessageQueue
				messages={queue}
				onEdit={onEditQueuedMessage}
				onRemove={onRemoveQueuedMessage}
				onReorder={onReorderQueuedMessages}
			/>
			<InputMessage
				value={value}
				onValueChange={onValueChange}
				onSend={() => void submitMessage()}
				disabled={composerDisabled}
				minRows={large ? 2 : 1}
				maxRows={8}
				placeholder={large ? "What should the agent work on?" : "Write a message…"}
				sendLabel={submitLabel}
				previewSlot={attachmentPreview}
				textareaProps={{ "aria-label": "Message" }}
				submitSlot={
					<Button
						type="button"
						variant={submitVariant}
						size="icon-sm"
						className={submitClassName}
						onClick={onSubmit}
						disabled={submitDisabled}
						aria-label={submitLabel}
					>
						{stopAction ? (
							<StopIcon className="block !size-[11px] [&_path]:fill-current [&_path]:stroke-none" />
						) : (
							<SendIcon size={19} />
						)}
					</Button>
				}
				leftSlot={
					<>
						<MessageAttachmentPicker
							attachments={attachments}
							disabled={pickerDisabled}
							onAdd={addAttachments}
							onError={setAttachmentError}
						/>
						<AgentModeControl
							mode={selectedAgentMode}
							disabled={isStreaming || isSubmitting}
							onSelect={onSelectAgentMode}
						/>
					</>
				}
				rightSlot={
					<div className="hidden min-[900px]:block">
						<ModelSelector
							config={providerConfig}
							selectedModelRef={selectedModelRef}
							loading={providerLoading}
							error={providerError}
							disabled={isStreaming || isSubmitting || providerLoading}
							onSelect={onSelectProviderModel}
							onManage={onOpenProviderSettings}
						/>
					</div>
				}
			/>
			{attachmentError ? (
				<p className="mt-1.5 px-2 text-[12px] text-destructive" role="alert">
					{attachmentError}
				</p>
			) : null}
			{showProjectPicker ? (
				<div className="mt-1.5 pl-2">
					<ProjectPicker
						project={project}
						projects={projects}
						disabled={isStreaming || isSubmitting}
						busy={projectBusy}
						loading={projectLoading}
						loadError={projectLoadError}
						onChoose={onChooseProject}
						onAdd={onAddProject}
						onRetry={onRetryProjects}
					/>
				</div>
			) : null}
		</div>
	);
}
