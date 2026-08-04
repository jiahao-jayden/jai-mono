import { useIcons } from "@/lib/icon-context";
import type {
	DesktopAgentStatus,
	DesktopProviderConfigSnapshot,
	DesktopWorkspace,
} from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { InputMessage, type QueuedMessage } from "../../ui/input-message";
import { ModelSelector } from "./model-selector";
import { WorkspacePicker } from "./workspace-picker";

interface ChatComposerProps {
	value: string;
	onValueChange(value: string): void;
	onSubmit(value: string, meta?: { queuedId?: string }): void;
	onAbort(): Promise<void>;
	status: DesktopAgentStatus;
	disabled: boolean;
	queue: QueuedMessage[];
	onQueueChange(queue: QueuedMessage[]): void;
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
	onSubmit,
	onAbort,
	status,
	disabled,
	queue,
	onQueueChange,
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
	const PlusIcon = useIcons().plus;

	return (
		<div>
			<InputMessage
				value={value}
				onValueChange={onValueChange}
				onSend={(message, _files, meta) => onSubmit(message, meta)}
				onStop={() => void onAbort()}
				status={status === "running" ? "streaming" : "idle"}
				queue={queue}
				onQueueChange={onQueueChange}
				disabled={disabled}
				minRows={large ? 2 : 1}
				maxRows={8}
				placeholder={large ? "What should the agent work on?" : "Write a message…"}
				sendLabel="Send message"
				textareaProps={{ "aria-label": "Message" }}
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
							disabled={status === "running" || providerLoading}
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
					disabled={status === "running"}
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
