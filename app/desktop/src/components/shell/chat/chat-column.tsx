import type { CodingSession } from "@jai/coding/business";
import type { PermissionResolution } from "@jai/coding/permissions/approval";
import { AnimatePresence } from "framer-motion";
import { type CSSProperties, type RefObject, type UIEvent, useLayoutEffect, useRef, useState } from "react";
import pandaLogo from "@/assets/icons/chat-area/panda-3.svg";
import { useIcons } from "@/lib/icon-context";
import type {
	DesktopAgentStatus,
	DesktopPermissionItem,
	DesktopProviderConfigSnapshot,
	DesktopTranscriptItem,
	DesktopWorkspace,
} from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import type { QueuedMessage } from "../../ui/input-message";
import { PermissionRequests } from "../../ui/permission-requests";
import { ChatComposer } from "./chat-composer";
import { TranscriptItems, TranscriptLoading } from "./chat-transcript";

interface ChatColumnProps {
	session?: CodingSession;
	workspace?: DesktopWorkspace;
	workspaces: readonly DesktopWorkspace[];
	status: DesktopAgentStatus;
	items: readonly DesktopTranscriptItem[];
	loading: boolean;
	error?: string;
	providerConfig?: DesktopProviderConfigSnapshot;
	selectedModelRef: string;
	providerLoading: boolean;
	providerError: boolean;
	workspaceBusy: boolean;
	workspaceLoading: boolean;
	workspaceLoadError: boolean;
	workspaceError?: string;
	sidebarOpen: boolean;
	rightPanelOpen: boolean;
	onToggleSidebar(): void;
	onToggleRightPanel(): void;
	onOpenProviderSettings(): void;
	onSelectProviderModel(modelRef: string): void;
	onChooseWorkspace(workspace: DesktopWorkspace): Promise<void>;
	onAddWorkspace(): Promise<void>;
	onRetryWorkspaces(): void;
	onSend(message: string): Promise<void>;
	onAbort(): Promise<void>;
	onResolvePermission(resolution: PermissionResolution): Promise<void>;
}

export function ChatColumn({
	session,
	workspace,
	workspaces,
	status,
	items,
	loading,
	error,
	providerConfig,
	selectedModelRef,
	providerLoading,
	providerError,
	workspaceBusy,
	workspaceLoading,
	workspaceLoadError,
	workspaceError,
	sidebarOpen,
	rightPanelOpen,
	onToggleSidebar,
	onToggleRightPanel,
	onOpenProviderSettings,
	onSelectProviderModel,
	onChooseWorkspace,
	onAddWorkspace,
	onRetryWorkspaces,
	onSend,
	onAbort,
	onResolvePermission,
}: ChatColumnProps) {
	const icons = useIcons();
	const FolderIcon = icons.folder;
	const FolderOffIcon = icons["folder-off"];
	const PanelLeftIcon = icons["panel-left-close"];
	const PanelRightIcon = icons["panel-right"];
	const [draft, setDraft] = useState("");
	const [queue, setQueue] = useState<QueuedMessage[]>([]);
	const [sending, setSending] = useState(false);
	const [sendError, setSendError] = useState<string>();
	const scrollRef = useRef<HTMLDivElement>(null);
	const followsTranscriptRef = useRef(true);
	useTranscriptAutoscroll(scrollRef, items, followsTranscriptRef);

	const submit = async (value: string, meta?: { queuedId?: string }) => {
		const message = value.trim();
		if (!message || sending) return;
		setSending(true);
		setSendError(undefined);
		try {
			await onSend(message);
			if (!meta?.queuedId) setDraft("");
		} catch {
			setSendError("消息未发送。请检查模型配置后重试。");
		} finally {
			setSending(false);
		}
	};

	const isNewChat = !session;
	const pendingPermissions = items.filter(
		(item): item is DesktopPermissionItem => item.kind === "permission" && item.status === "pending",
	);
	const transcriptItems =
		pendingPermissions.length > 0
			? items.filter((item) => item.kind !== "permission" || item.status !== "pending")
			: items;

	const workspaceLabel =
		workspace?.displayName ??
		(workspaceLoading ? "Loading workspace…" : workspaceLoadError ? "Workspaces unavailable" : null);

	const drag = { WebkitAppRegion: "drag" } as CSSProperties;
	const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;
	const updateTranscriptFollowState = (event: UIEvent<HTMLDivElement>) => {
		const element = event.currentTarget;
		followsTranscriptRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 48;
	};

	return (
		<section className="flex min-w-0 flex-1 flex-col bg-background">
			<header
				className={`flex h-13 shrink-0 items-center justify-between pr-5 ${sidebarOpen ? "pl-5" : "pl-20"}`}
				style={drag}
			>
				<div className="flex min-w-0 items-center gap-2.5 text-[15px]">
					{!sidebarOpen ? (
						<div className="mr-1 shrink-0" style={noDrag}>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								onClick={onToggleSidebar}
								aria-label="Show sidebar"
								title="Show sidebar"
								className="text-muted-foreground"
							>
								<PanelLeftIcon size={16} />
							</Button>
						</div>
					) : null}
					{workspaceLabel ? (
						<>
							{workspace && !workspace.available ? (
								<FolderOffIcon size={16} className="shrink-0 text-destructive" />
							) : (
								<FolderIcon size={16} className="shrink-0 text-muted-foreground" />
							)}
							<span className="max-w-40 truncate font-semibold">{workspaceLabel}</span>
						</>
					) : null}
					{session ? (
						<>
							{workspaceLabel ? <span className="text-muted-foreground/40">/</span> : null}
							<span className="truncate font-semibold">{session.title}</span>
						</>
					) : null}
				</div>
				<div style={noDrag}>
					{session ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={onToggleRightPanel}
							aria-pressed={rightPanelOpen}
							aria-label={rightPanelOpen ? "Hide task panel" : "Show task panel"}
							title={rightPanelOpen ? "Hide task panel" : "Show task panel"}
							className="shrink-0 text-muted-foreground"
						>
							<PanelRightIcon size={16} />
						</Button>
					) : (
						<span className="size-8" aria-hidden="true" />
					)}
				</div>
			</header>

			{isNewChat ? (
				<div className="flex min-h-0 flex-1 items-center justify-center px-8 pb-[8vh]">
					<div className="w-full max-w-[720px]">
						<div className="mb-7 text-center">
							<img
								src={pandaLogo}
								alt=""
								aria-hidden="true"
								className="mx-auto mb-5 h-20 w-auto select-none"
								draggable={false}
							/>
							<h1 className="font-serif text-[34px] tracking-[-0.025em] text-foreground">
								{greeting()}, Jiahao
							</h1>
							<p className="mt-2.5 text-[15px] text-muted-foreground">
								Start a chat or hand a task to a local agent.
							</p>
						</div>
						<ChatComposer
							value={draft}
							onValueChange={setDraft}
							onSubmit={submit}
							onAbort={onAbort}
							status={status}
							disabled={sending || workspace?.available === false}
							queue={queue}
							onQueueChange={setQueue}
							workspace={workspace}
							workspaces={workspaces}
							workspaceBusy={workspaceBusy}
							workspaceLoading={workspaceLoading}
							workspaceLoadError={workspaceLoadError}
							onChooseWorkspace={onChooseWorkspace}
							onAddWorkspace={onAddWorkspace}
							onRetryWorkspaces={onRetryWorkspaces}
							providerConfig={providerConfig}
							selectedModelRef={selectedModelRef}
							providerLoading={providerLoading}
							providerError={providerError}
							onOpenProviderSettings={onOpenProviderSettings}
							onSelectProviderModel={onSelectProviderModel}
							large
						/>
						<ComposerError message={sendError || workspaceError || error} />
					</div>
				</div>
			) : (
				<>
					<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" onScroll={updateTranscriptFollowState}>
						<div className="mx-auto flex w-full max-w-[760px] flex-col gap-2 px-8 py-5">
							{loading ? <TranscriptLoading /> : null}
							{!loading && items.length === 0 ? (
								<p className="py-16 text-center text-[13px] text-muted-foreground">这个会话还没有消息。</p>
							) : null}
							<TranscriptItems items={transcriptItems} />
						</div>
					</div>
					<div className="shrink-0 px-8 pb-3">
						<div className="mx-auto flex w-full max-w-[760px] flex-col gap-2">
							<AnimatePresence initial={false}>
								{pendingPermissions.length > 0 ? (
									<PermissionRequests
										key="permission-requests"
										requests={pendingPermissions.map((item) => ({
											id: item.request.requestId,
											title: item.request.summary.title,
											description: item.request.summary.description || item.request.reason,
											command: item.request.summary.command,
											path: item.request.summary.path,
										}))}
										onResolve={(requestId, decision) => onResolvePermission({ requestId, decision })}
									/>
								) : null}
							</AnimatePresence>
							<ChatComposer
								value={draft}
								onValueChange={setDraft}
								onSubmit={submit}
								onAbort={onAbort}
								status={status}
								disabled={sending || workspace?.available === false}
								queue={queue}
								onQueueChange={setQueue}
								workspace={workspace}
								workspaces={workspaces}
								workspaceBusy={workspaceBusy}
								workspaceLoading={workspaceLoading}
								workspaceLoadError={workspaceLoadError}
								onChooseWorkspace={onChooseWorkspace}
								onAddWorkspace={onAddWorkspace}
								onRetryWorkspaces={onRetryWorkspaces}
								providerConfig={providerConfig}
								selectedModelRef={selectedModelRef}
								providerLoading={providerLoading}
								providerError={providerError}
								onOpenProviderSettings={onOpenProviderSettings}
								onSelectProviderModel={onSelectProviderModel}
							/>
							<ComposerError message={sendError || workspaceError || error} />
						</div>
					</div>
				</>
			)}
		</section>
	);
}

function ComposerError({ message }: { message?: string }) {
	return message ? (
		<p className="mt-2 px-2 text-[12px] text-destructive" role="alert" aria-live="assertive">
			{message}
		</p>
	) : null;
}

function useTranscriptAutoscroll(
	ref: RefObject<HTMLDivElement | null>,
	items: readonly DesktopTranscriptItem[],
	followsTranscriptRef: RefObject<boolean>,
) {
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element || items.length === 0 || !followsTranscriptRef.current) return;
		element.scrollTop = element.scrollHeight;
	}, [items, ref, followsTranscriptRef]);
}

function greeting(): string {
	const hour = new Date().getHours();
	if (hour < 12) return "Good morning";
	if (hour < 18) return "Good afternoon";
	return "Good evening";
}
