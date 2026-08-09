import { useEffect, useRef, useState } from "react";
import type { ChatMessageInput, ChatStatus } from "@/hooks/use-chat";
import { rememberAttachmentFiles } from "@/lib/attachment-files";
import { desktop, desktopFilePath } from "@/lib/desktop";
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
import { MessageAttachmentPicker } from "./message-attachment-picker";
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

const MAX_MESSAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ALL_FILES_ACCEPT = "*/*";
const COMPOSER_FILE_PREVIEW_SIZE = 120;

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
	const [files, setFiles] = useState<File[]>([]);
	const [attachments, setAttachments] = useState<readonly DesktopMessageAttachment[]>([]);
	const [attachmentError, setAttachmentError] = useState<string | undefined>(undefined);
	const [registeringAttachments, setRegisteringAttachments] = useState(false);
	const attachmentRef = useRef(attachments);
	const hasDraft = value.trim().length > 0;
	const hasAttachments = files.length > 0;
	const hasMessageContent = hasDraft || hasAttachments;
	const isStreaming = status === "streaming";
	const isSubmitting = status === "submitted";
	const stopAction = isStreaming && !hasMessageContent;
	const submitLabel = stopAction ? "Stop response" : isStreaming ? "Queue message" : "Send message";
	const composerDisabled = disabled || isSubmitting || registeringAttachments;
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

	const fileKey = (file: File): string => `${file.name}-${file.size}-${file.lastModified}`;
	const handleFilesChange = async (nextFiles: File[]) => {
		const total = nextFiles.reduce((sum, file) => sum + file.size, 0);
		if (total > MAX_MESSAGE_ATTACHMENT_BYTES) {
			setAttachmentError("Attachments must be 20 MB or less in total.");
			return;
		}

		const previousFiles = files;
		const previousAttachments = attachments;
		const previousByKey = new Map(previousFiles.map((file, index) => [fileKey(file), previousAttachments[index]]));
		const nextExisting = nextFiles.flatMap((file) => {
			const attachment = previousByKey.get(fileKey(file));
			return attachment ? [attachment] : [];
		});
		const nextKeys = new Set(nextFiles.map(fileKey));
		const removedIds = previousFiles.flatMap((file, index) =>
			nextKeys.has(fileKey(file)) || !previousAttachments[index] ? [] : [previousAttachments[index]!.id],
		);
		if (removedIds.length > 0) void desktop.attachment.release(removedIds);

		setFiles(nextFiles);
		setAttachments(nextExisting);
		setAttachmentError(undefined);
		const newFiles = nextFiles.filter((file) => !previousByKey.has(fileKey(file)));
		if (newFiles.length === 0) return;

		setRegisteringAttachments(true);
		try {
			const registered = await Promise.all(
				newFiles.map((file) =>
					desktop.attachment.register({
						sourcePath: desktopFilePath(file),
						filename: file.name,
						mimeType: file.type || "application/octet-stream",
						size: file.size,
					}),
				),
			);
			rememberAttachmentFiles(registered, newFiles);
			const registeredByKey = new Map(
				registered.map((attachment, index) => [fileKey(newFiles[index]!), attachment]),
			);
			const nextAttachments = nextFiles.flatMap((file) => {
				const attachment = previousByKey.get(fileKey(file)) ?? registeredByKey.get(fileKey(file));
				return attachment ? [attachment] : [];
			});
			setAttachments(nextAttachments);
		} catch (error) {
			setFiles(previousFiles);
			setAttachments(previousAttachments);
			setAttachmentError(error instanceof Error ? error.message : "Could not add those files.");
		} finally {
			setRegisteringAttachments(false);
		}
	};
	const submitMessage = async () => {
		if (stopAction) {
			void onStop();
			return;
		}
		const accepted = await onSend({ text: value, mode: selectedAgentMode, attachments });
		if (accepted) {
			const ids = attachments.map((attachment) => attachment.id);
			if (ids.length > 0) void desktop.attachment.release(ids);
			setFiles([]);
			setAttachments([]);
			setAttachmentError(undefined);
		}
	};
	const onSubmit = () => void submitMessage();
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
				files={files}
				onFilesChange={(nextFiles) => void handleFilesChange(nextFiles)}
				accept={ALL_FILES_ACCEPT}
				filePreviewSize={COMPOSER_FILE_PREVIEW_SIZE}
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
				leftSlot={({ openFilePicker }) => (
					<>
						<MessageAttachmentPicker disabled={pickerDisabled} onOpen={() => openFilePicker()} />
						<AgentModeControl
							mode={selectedAgentMode}
							disabled={isStreaming || isSubmitting}
							onSelect={onSelectAgentMode}
						/>
					</>
				)}
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
