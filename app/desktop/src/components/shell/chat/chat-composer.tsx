import type { ChatMessageInput, ChatStatus } from "@/hooks/use-chat";
import { useIcons } from "@/lib/icon-context";
import type { QueuedMessage } from "@/stores/chat";
import type { DesktopProviderConfigSnapshot, DesktopWorkspace } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { InputMessage } from "../../ui/input-message";
import { ChatMessageQueue } from "./chat-message-queue";
import { ModelSelector } from "./model-selector";
import { WorkspacePicker } from "./workspace-picker";

interface ChatComposerProps {
	value: string;
	onValueChange(value: string): void;
	onSend(message: ChatMessageInput): Promise<void>;
	onStop(): Promise<void>;
	status: ChatStatus;
	disabled: boolean;
	queue: readonly QueuedMessage[];
	onEditQueuedMessage(messageId: string): void;
	onRemoveQueuedMessage(messageId: string): void;
	onReorderQueuedMessages(messageIds: readonly string[]): void;
	workspace?: DesktopWorkspace;
	workspaces: readonly DesktopWorkspace[];
	workspaceBusy: boolean;
	workspaceLoading: boolean;
	workspaceLoadError: boolean;
	onChooseWorkspace(workspace: DesktopWorkspace): Promise<void>;
	onAddWorkspace(): Promise<void>;
	onRetryWorkspaces(): void;
	providerConfig?: DesktopProviderConfigSnapshot;
	selectedModelRef: string;
	providerLoading: boolean;
	providerError: boolean;
	onOpenProviderSettings(): void;
	onSelectProviderModel(modelRef: string): void;
	large?: boolean;
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
	workspace,
	workspaces,
	workspaceBusy,
	workspaceLoading,
	workspaceLoadError,
	onChooseWorkspace,
	onAddWorkspace,
	onRetryWorkspaces,
	providerConfig,
	selectedModelRef,
	providerLoading,
	providerError,
	onOpenProviderSettings,
	onSelectProviderModel,
	large = false,
}: ChatComposerProps) {
	const icons = useIcons();
	const PlusIcon = icons.plus;
	const SendIcon = icons.send;
	const StopIcon = icons["stop-circle"];
	const hasDraft = value.trim().length > 0;
	const isStreaming = status === "streaming";
	const isSubmitting = status === "submitted";
	const stopAction = isStreaming && !hasDraft;
	const submitLabel = stopAction ? "Stop response" : isStreaming ? "Queue message" : "Send message";
	const composerDisabled = disabled || isSubmitting;
	const submitDisabled = composerDisabled || (!stopAction && !hasDraft);
	const onSubmit = () => {
		if (stopAction) {
			void onStop();
			return;
		}
		void onSend({ text: value });
	};

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
				onSend={(message) => void onSend({ text: message })}
				disabled={composerDisabled}
				minRows={large ? 2 : 1}
				maxRows={8}
				placeholder={large ? "What should the agent work on?" : "Write a message…"}
				sendLabel={submitLabel}
				textareaProps={{ "aria-label": "Message" }}
				submitSlot={
					<Button
						type="button"
						variant="accent"
						size="icon-sm"
						onClick={onSubmit}
						disabled={submitDisabled}
						aria-label={submitLabel}
					>
						{stopAction ? <StopIcon size={18} /> : <SendIcon size={19} />}
					</Button>
				}
				leftSlot={
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						disabled
						aria-label="Attach files"
						title="File attachments are coming later"
					>
						<PlusIcon size={14} strokeWidth={1.5} />
					</Button>
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
			<div className="mt-1.5 pl-2">
				<WorkspacePicker
					workspace={workspace}
					workspaces={workspaces}
					disabled={isStreaming || isSubmitting}
					busy={workspaceBusy}
					loading={workspaceLoading}
					loadError={workspaceLoadError}
					onChoose={onChooseWorkspace}
					onAdd={onAddWorkspace}
					onRetry={onRetryWorkspaces}
				/>
			</div>
		</div>
	);
}
