import type { CodingSession } from "@jai/coding-agent/business";
import { getErrorMessage } from "@jai/common";
import { AnimatePresence, useReducedMotion } from "framer-motion";
import {
	type CSSProperties,
	type KeyboardEvent,
	type PointerEvent,
	type RefObject,
	type TouchEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type WheelEvent,
} from "react";
import { ThinkingOrb } from "thinking-orbs";
import pandaLogo from "@/assets/icons/chat-area/panda-3.svg";
import type { Chat } from "@/hooks/use-chat";
import { useIcons } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { QueuedMessage } from "@/stores/chat";
import type {
	DesktopAgentMode,
	DesktopConnectorPermissionItem,
	DesktopPermissionItem,
	DesktopProject,
	DesktopProviderConfigSnapshot,
	DesktopTranscriptItem,
} from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { MessageScroller } from "../../ui/message-scroller";
import { PermissionRequests } from "../../ui/permission-requests";
import { toast } from "../../ui/toast";
import { ChatComposer } from "./chat-composer";
import { TranscriptItems, TranscriptLoading } from "./chat-transcript";
import {
	comfortableScrollTop,
	isTranscriptAwayFromBottom,
	isTranscriptScrollKey,
	promptAnchorScrollTop,
	transcriptPromptAnchorRatio,
} from "./transcript-scroll";

interface ChatColumnProps {
	session?: CodingSession;
	project?: DesktopProject;
	projects: readonly DesktopProject[];
	chat: Chat;
	draft: string;
	queue: readonly QueuedMessage[];
	onDraftChange(value: string): void;
	onEditQueuedMessage(messageId: string): void;
	onRemoveQueuedMessage(messageId: string): void;
	onReorderQueuedMessages(orderedIds: readonly string[]): void;
	providerConfig?: DesktopProviderConfigSnapshot;
	selectedModelRef: string;
	selectedAgentMode: DesktopAgentMode;
	providerLoading: boolean;
	providerError: boolean;
	projectBusy: boolean;
	projectLoading: boolean;
	projectLoadError: boolean;
	projectError?: string;
	sidebarOpen: boolean;
	artifactPanelOpen: boolean;
	onToggleSidebar(): void;
	onToggleArtifactPanel(): void;
	onOpenProviderSettings(): void;
	onSelectProviderModel(modelRef: string): void;
	onSelectAgentMode(mode: DesktopAgentMode): void;
	onChooseProject(project: DesktopProject): Promise<void>;
	onAddProject(): Promise<void>;
	onRetryProjects(): void;
	onRenameSession(sessionId: string, title: string): Promise<void>;
}

export function ChatColumn({
	session,
	project,
	projects,
	chat,
	draft,
	queue,
	onDraftChange,
	onEditQueuedMessage,
	onRemoveQueuedMessage,
	onReorderQueuedMessages,
	providerConfig,
	selectedModelRef,
	selectedAgentMode,
	providerLoading,
	providerError,
	projectBusy,
	projectLoading,
	projectLoadError,
	projectError,
	sidebarOpen,
	artifactPanelOpen,
	onToggleSidebar,
	onToggleArtifactPanel,
	onOpenProviderSettings,
	onSelectProviderModel,
	onSelectAgentMode,
	onChooseProject,
	onAddProject,
	onRetryProjects,
	onRenameSession,
}: ChatColumnProps) {
	const icons = useIcons();
	const FolderIcon = icons.folder;
	const FolderOffIcon = icons["folder-off"];
	const PanelLeftIcon = icons["panel-left-close"];
	const PanelRightIcon = icons["panel-right"];
	const scrollRef = useRef<HTMLDivElement>(null);
	const cancelTitleEditRef = useRef(false);
	const reducedMotion = useReducedMotion();
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState("");

	const isNewChat = !session;
	const isAgentWorking = chat.status === "submitted" || chat.status === "streaming";
	const pendingPermissions = chat.messages.filter(
		(item): item is DesktopPermissionItem => item.kind === "permission" && item.status === "pending",
	);
	const pendingConnectorPermissions = chat.messages.filter(
		(item): item is DesktopConnectorPermissionItem =>
			item.kind === "connector_permission" && item.status === "pending",
	);
	const pendingApprovals = [...pendingPermissions, ...pendingConnectorPermissions];
	const transcriptItems =
		pendingApprovals.length > 0
			? chat.messages.filter(
					(item) =>
						(item.kind !== "permission" && item.kind !== "connector_permission") || item.status !== "pending",
				)
			: chat.messages;
	const transcriptScroll = useTranscriptScroll({
		ref: scrollRef,
		sessionId: session?.id,
		items: transcriptItems,
		loading: chat.isLoading,
		responding: isAgentWorking,
		reducedMotion,
	});

	const projectLabel =
		project?.displayName ?? (projectLoading ? "Loading project…" : projectLoadError ? "Projects unavailable" : null);

	const drag = { WebkitAppRegion: "drag" } as CSSProperties;
	const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;
	const startTitleEditing = () => {
		if (!session) return;
		cancelTitleEditRef.current = false;
		setTitleDraft(session.title);
		setEditingTitle(true);
	};
	const cancelTitleEditing = () => {
		cancelTitleEditRef.current = true;
		setEditingTitle(false);
	};
	const saveTitle = async () => {
		if (cancelTitleEditRef.current) {
			cancelTitleEditRef.current = false;
			return;
		}

		setEditingTitle(false);
		const title = titleDraft.trim();
		if (!session || !title || title === session.title) return;

		try {
			await onRenameSession(session.id, title);
		} catch (reason) {
			toast.add({
				title: "无法重命名会话",
				description: getErrorMessage(reason),
				type: "error",
			});
		}
	};

	return (
		<section className="flex min-w-0 flex-1 flex-col bg-background">
			<header
				className={cn("flex h-13 shrink-0 items-center justify-between pr-5", sidebarOpen ? "pl-5" : "pl-20")}
				style={drag}
			>
				<div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden text-[15px]">
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
					{projectLabel ? (
						<>
							{project && !project.available ? (
								<FolderOffIcon size={16} className="shrink-0 text-destructive" />
							) : (
								<FolderIcon size={16} className="shrink-0 text-muted-foreground" />
							)}
							<span className="max-w-40 truncate font-semibold">{projectLabel}</span>
						</>
					) : null}
					{session ? (
						<>
							{projectLabel ? <span className="text-muted-foreground/40">/</span> : null}
							{editingTitle ? (
								<Input
									autoFocus
									density="compact"
									value={titleDraft}
									onChange={(event) => setTitleDraft(event.target.value)}
									onBlur={() => void saveTitle()}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											event.currentTarget.blur();
										} else if (event.key === "Escape") {
											event.preventDefault();
											cancelTitleEditing();
										}
									}}
									aria-label="Session title"
									maxLength={80}
									className="h-7 min-w-0 max-w-64 flex-1 border-transparent bg-hover px-2 text-[15px] font-semibold"
									style={noDrag}
								/>
							) : (
								<Button
									type="button"
									variant="ghost"
									size="md"
									onDoubleClick={startTitleEditing}
									onKeyDown={(event) => {
										if (event.key === "F2") {
											event.preventDefault();
											startTitleEditing();
										}
									}}
									aria-label={`Edit session title: ${session.title}`}
									title="Double-click to rename"
									contentClassName="min-w-0 max-w-full"
									labelClassName="min-w-0 truncate text-left leading-6 ![text-box:normal]"
									className="h-7 min-w-0 max-w-64 flex-1 justify-start px-1 text-[15px] font-semibold text-foreground"
									style={noDrag}
								>
									{session.title}
								</Button>
							)}
						</>
					) : null}
				</div>
				<div className="shrink-0" style={noDrag}>
					{session ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={onToggleArtifactPanel}
							aria-expanded={artifactPanelOpen}
							aria-controls="workspace-panel"
							aria-label={artifactPanelOpen ? "Close workspace" : "Open workspace"}
							title={artifactPanelOpen ? "Close workspace" : "Open workspace"}
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
					<div className="w-full max-w-180">
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
							onValueChange={onDraftChange}
							onSend={chat.sendMessage}
							onStop={chat.stop}
							status={chat.status}
							disabled={project?.available === false}
							queue={queue}
							onEditQueuedMessage={onEditQueuedMessage}
							onRemoveQueuedMessage={onRemoveQueuedMessage}
							onReorderQueuedMessages={onReorderQueuedMessages}
							project={project}
							projects={projects}
							projectBusy={projectBusy}
							projectLoading={projectLoading}
							projectLoadError={projectLoadError}
							onChooseProject={onChooseProject}
							onAddProject={onAddProject}
							onRetryProjects={onRetryProjects}
							providerConfig={providerConfig}
							selectedModelRef={selectedModelRef}
							selectedAgentMode={selectedAgentMode}
							providerLoading={providerLoading}
							providerError={providerError}
							onOpenProviderSettings={onOpenProviderSettings}
							onSelectProviderModel={onSelectProviderModel}
							onSelectAgentMode={onSelectAgentMode}
							large
						/>
						<ComposerError message={chat.error || projectError} />
					</div>
				</div>
			) : (
				<>
					<div className="relative min-h-0 flex-1">
						<div
							ref={scrollRef}
							className="h-full overflow-y-auto"
							onKeyDownCapture={transcriptScroll.onKeyDownCapture}
							onPointerDown={transcriptScroll.onPointerDown}
							onPointerMove={transcriptScroll.onPointerMove}
							onPointerUp={transcriptScroll.onPointerUp}
							onPointerCancel={transcriptScroll.onPointerUp}
							onScroll={transcriptScroll.onScroll}
							onTouchMove={transcriptScroll.onTouchMove}
							onWheel={transcriptScroll.onWheel}
						>
							<div className="px-5">
								<div className="mx-auto flex w-full max-w-190 flex-col gap-2 py-5">
									{chat.isLoading ? <TranscriptLoading /> : null}
									{!chat.isLoading && chat.messages.length === 0 ? (
										<p className="py-16 text-center text-[13px] text-muted-foreground">
											这个会话还没有消息。
										</p>
									) : null}
									<TranscriptItems items={transcriptItems} loading={chat.isLoading} />
									{isAgentWorking ? (
										<div className="flex items-center gap-2 px-1 py-1 text-muted-foreground" role="status">
											<ThinkingOrb aria-hidden size={20} state="solving" />
											<span className="shimmer-text text-[12px] font-medium">Agent 正在处理…</span>
										</div>
									) : null}
									{transcriptScroll.tailSpace > 0 ? (
										<div
											aria-hidden="true"
											className="shrink-0"
											style={{ height: transcriptScroll.tailSpace }}
										/>
									) : null}
								</div>
							</div>
						</div>
						<MessageScroller
							onScrollToBottom={transcriptScroll.scrollToBottom}
							visible={transcriptScroll.showMessageScroller}
						/>
					</div>
					<div className="shrink-0 px-5 pb-3">
						<div className="mx-auto flex w-full max-w-190 flex-col gap-2">
							<AnimatePresence initial={false}>
								{pendingApprovals.length > 0 ? (
									<PermissionRequests
										key="permission-requests"
										requests={pendingApprovals.map((item) =>
											item.kind === "permission"
												? {
														id: item.request.requestId,
														kind: "permission" as const,
														title: item.request.summary.title,
														description: item.request.summary.description || item.request.reason,
														command: item.request.summary.command,
														path: item.request.summary.path,
														canAlwaysAllow:
															item.request.canAlwaysAllow ?? Boolean(item.request.suggestedRule),
													}
												: {
														id: item.request.requestId,
														kind: "connector" as const,
														title: "Connector action requests permission",
														description: item.request.reason,
														actionId: item.request.actionId,
														inputKeys: item.request.inputKeys,
														canAlwaysAllow: false,
													},
										)}
										onResolve={(requestId, decision) => {
											const request = pendingApprovals.find((item) => item.request.requestId === requestId);
											if (request?.kind === "connector_permission") {
												return chat.resolvePermission({
													kind: "connector",
													requestId,
													decision: decision === "deny" ? "deny" : "allowOnce",
												});
											}
											return chat.resolvePermission({ requestId, decision });
										}}
									/>
								) : null}
							</AnimatePresence>
							<ChatComposer
								value={draft}
								onValueChange={onDraftChange}
								onSend={chat.sendMessage}
								onStop={chat.stop}
								status={chat.status}
								disabled={project?.available === false}
								queue={queue}
								onEditQueuedMessage={onEditQueuedMessage}
								onRemoveQueuedMessage={onRemoveQueuedMessage}
								onReorderQueuedMessages={onReorderQueuedMessages}
								project={project}
								projects={projects}
								projectBusy={projectBusy}
								projectLoading={projectLoading}
								projectLoadError={projectLoadError}
								onChooseProject={onChooseProject}
								onAddProject={onAddProject}
								onRetryProjects={onRetryProjects}
								providerConfig={providerConfig}
								selectedModelRef={selectedModelRef}
								selectedAgentMode={selectedAgentMode}
								providerLoading={providerLoading}
								providerError={providerError}
								onOpenProviderSettings={onOpenProviderSettings}
								onSelectProviderModel={onSelectProviderModel}
								onSelectAgentMode={onSelectAgentMode}
							/>
							<ComposerError message={chat.error || projectError} />
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

interface TranscriptScrollOptions {
	ref: RefObject<HTMLDivElement | null>;
	sessionId?: string;
	items: readonly DesktopTranscriptItem[];
	loading: boolean;
	responding: boolean;
	reducedMotion: boolean | null;
}

function useTranscriptScroll({ ref, sessionId, items, loading, responding, reducedMotion }: TranscriptScrollOptions) {
	const stateRef = useRef({
		sessionId,
		awaitingSnapshot: true,
		followsNewResponse: false,
		lastUserMessageId: undefined as string | undefined,
		expectedScrollTop: 0,
	});
	const [tailSpace, setTailSpace] = useState(0);
	const tailSpaceRef = useRef(0);
	const committedTailSpaceRef = useRef(0);
	const promptScrollFrameRef = useRef<number | undefined>(undefined);
	const streamingScrollFrameRef = useRef<number | undefined>(undefined);
	const streamingScrollTargetRef = useRef(0);
	const streamingScrollTimestampRef = useRef<number | undefined>(undefined);
	const anchoringRef = useRef(false);
	const anchorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const nativeScrollActiveRef = useRef(false);
	const scrollEpochRef = useRef(0);
	const itemsRef = useRef(items);
	const respondingRef = useRef(responding);
	const previousRespondingRef = useRef(responding);
	itemsRef.current = items;
	respondingRef.current = responding;
	const responseJustFinished = previousRespondingRef.current && !responding;
	const [showMessageScroller, setShowMessageScroller] = useState(false);
	const pointerStartRef = useRef<{ x: number; y: number } | undefined>(undefined);

	// Marks a stretch of programmatic smooth scrolling (prompt anchoring, jump
	// to bottom) so onScroll's user-scroll detector doesn't mistake the
	// in-flight animation frames for a manual scroll and detach mid-glide.
	const beginAnchoredScroll = useCallback(() => {
		anchoringRef.current = true;
		nativeScrollActiveRef.current = true;
		if (anchorTimerRef.current) clearTimeout(anchorTimerRef.current);
		anchorTimerRef.current = setTimeout(() => {
			anchoringRef.current = false;
			nativeScrollActiveRef.current = false;
			anchorTimerRef.current = undefined;
			const element = ref.current;
			if (element) stateRef.current.expectedScrollTop = element.scrollTop;
		}, 600);
	}, [ref]);

	const applyTailSpace = useCallback((next: number) => {
		tailSpaceRef.current = next;
		setTailSpace((current) => (Math.abs(current - next) < 1 ? current : next));
	}, []);

	const cancelAnchoredScroll = useCallback(() => {
		scrollEpochRef.current += 1;
		anchoringRef.current = false;
		nativeScrollActiveRef.current = false;
		if (anchorTimerRef.current) {
			clearTimeout(anchorTimerRef.current);
			anchorTimerRef.current = undefined;
		}
		const element = ref.current;
		if (element) {
			element.scrollTo({ top: element.scrollTop, behavior: "auto" });
			stateRef.current.expectedScrollTop = element.scrollTop;
		}
	}, [ref]);

	const cancelScheduledScroll = useCallback(() => {
		scrollEpochRef.current += 1;
		if (promptScrollFrameRef.current !== undefined) {
			cancelAnimationFrame(promptScrollFrameRef.current);
			promptScrollFrameRef.current = undefined;
		}
		if (nativeScrollActiveRef.current) cancelAnchoredScroll();
	}, [cancelAnchoredScroll]);

	const cancelStreamingScroll = useCallback(() => {
		if (streamingScrollFrameRef.current !== undefined) {
			cancelAnimationFrame(streamingScrollFrameRef.current);
			streamingScrollFrameRef.current = undefined;
		}
		streamingScrollTimestampRef.current = undefined;
		const element = ref.current;
		if (element) streamingScrollTargetRef.current = element.scrollTop;
	}, [ref]);

	const followStreamingResponse = useCallback(
		(element: HTMLDivElement, itemId: string) => {
			const response = findTranscriptItemElement(element, itemId);
			if (!response) return;
			const responseBottom =
				element.scrollTop + response.getBoundingClientRect().bottom - element.getBoundingClientRect().top;
			const target = Math.min(
				comfortableScrollTop(element.scrollTop, element.clientHeight, responseBottom),
				element.scrollHeight - element.clientHeight,
			);
			if (nativeScrollActiveRef.current) cancelAnchoredScroll();
			streamingScrollTargetRef.current = target;
			if (target <= element.scrollTop + 0.5) return;

			if (reducedMotion) {
				element.scrollTop = target;
				stateRef.current.expectedScrollTop = element.scrollTop;
				return;
			}
			if (streamingScrollFrameRef.current !== undefined) return;

			const step = (timestamp: number) => {
				const current = ref.current;
				if (!current || !stateRef.current.followsNewResponse) {
					streamingScrollFrameRef.current = undefined;
					streamingScrollTimestampRef.current = undefined;
					return;
				}
				const previousTimestamp = streamingScrollTimestampRef.current ?? timestamp;
				const elapsed = Math.min(timestamp - previousTimestamp, 32);
				streamingScrollTimestampRef.current = timestamp;
				const distance = streamingScrollTargetRef.current - current.scrollTop;
				if (distance <= 0.5) {
					current.scrollTop = streamingScrollTargetRef.current;
					stateRef.current.expectedScrollTop = current.scrollTop;
					streamingScrollFrameRef.current = undefined;
					streamingScrollTimestampRef.current = undefined;
					return;
				}
				const progress = 1 - Math.exp(-elapsed / 72);
				current.scrollTop += distance * progress;
				stateRef.current.expectedScrollTop = current.scrollTop;
				streamingScrollFrameRef.current = requestAnimationFrame(step);
			};
			streamingScrollFrameRef.current = requestAnimationFrame(step);
		},
		[cancelAnchoredScroll, reducedMotion, ref],
	);

	const syncMessageScroller = useCallback(() => {
		const element = ref.current;
		if (!element) return;
		const isAwayFromBottom = isTranscriptAwayFromBottom(
			element.scrollTop,
			element.clientHeight,
			element.scrollHeight,
		);
		const shouldShow = isAwayFromBottom && !stateRef.current.followsNewResponse;
		setShowMessageScroller((current) => (current === shouldShow ? current : shouldShow));
	}, [ref]);

	const stopFollowing = useCallback(() => {
		const wasFollowing = stateRef.current.followsNewResponse;
		stateRef.current.followsNewResponse = false;
		cancelStreamingScroll();
		if (wasFollowing || nativeScrollActiveRef.current) cancelScheduledScroll();
	}, [cancelScheduledScroll, cancelStreamingScroll]);

	const scrollToBottom = useCallback(() => {
		const element = ref.current;
		if (!element) return;
		cancelScheduledScroll();
		cancelStreamingScroll();
		stateRef.current.followsNewResponse = true;
		setShowMessageScroller(false);
		beginAnchoredScroll();
		element.scrollTo({
			top: element.scrollHeight,
			behavior: reducedMotion ? "auto" : "smooth",
		});
	}, [beginAnchoredScroll, cancelScheduledScroll, cancelStreamingScroll, reducedMotion, ref]);

	useLayoutEffect(() => {
		if (stateRef.current.sessionId !== sessionId) {
			cancelScheduledScroll();
			cancelStreamingScroll();
			stateRef.current = {
				sessionId,
				awaitingSnapshot: true,
				followsNewResponse: false,
				lastUserMessageId: undefined,
				expectedScrollTop: 0,
			};
			anchoringRef.current = false;
			applyTailSpace(0);
			setShowMessageScroller(false);
		}
		if (loading) {
			cancelScheduledScroll();
			cancelStreamingScroll();
			stateRef.current.awaitingSnapshot = true;
			stateRef.current.followsNewResponse = false;
			stateRef.current.lastUserMessageId = undefined;
			applyTailSpace(0);
			setShowMessageScroller(false);
			return;
		}
		const element = ref.current;
		if (!element) return;
		if (stateRef.current.followsNewResponse) stateRef.current.expectedScrollTop = element.scrollTop;

		const latestUser = lastMessageForRole(items, "user");
		if (stateRef.current.awaitingSnapshot) {
			stateRef.current.awaitingSnapshot = false;
			stateRef.current.lastUserMessageId = latestUser?.id;
			applyTailSpace(0);
			element.scrollTop = element.scrollHeight;
			stateRef.current.expectedScrollTop = element.scrollTop;
			setShowMessageScroller(false);
			return;
		}

		if (latestUser && latestUser.id !== stateRef.current.lastUserMessageId) {
			cancelScheduledScroll();
			cancelStreamingScroll();
			const promptId = latestUser.id;
			stateRef.current.lastUserMessageId = promptId;
			stateRef.current.followsNewResponse = true;
			applyTailSpace(measureTailSpace(element, promptId, tailSpaceRef.current));
			setShowMessageScroller(false);
			// Anchor the prompt to the top only after the spacer's height commits:
			// scrolling now would clamp against the stale, spacer-less scrollHeight.
			if (promptScrollFrameRef.current !== undefined) cancelAnimationFrame(promptScrollFrameRef.current);
			const scrollEpoch = scrollEpochRef.current;
			promptScrollFrameRef.current = requestAnimationFrame(() => {
				promptScrollFrameRef.current = undefined;
				const current = ref.current;
				if (!current || scrollEpoch !== scrollEpochRef.current || stateRef.current.sessionId !== sessionId) return;
				beginAnchoredScroll();
				scrollPromptIntoReadingPosition(current, promptId, reducedMotion);
			});
			return;
		}

		// Keep the spacer sized to exactly what the latest prompt needs to sit at
		// the top: it shrinks to zero as a long reply fills the viewport, and
		// holds just enough for a short reply so the prompt never drops back down.
		const promptId = stateRef.current.lastUserMessageId;
		if (promptId) applyTailSpace(measureTailSpace(element, promptId, tailSpaceRef.current));

		const latestScrollableItem = lastScrollableTranscriptItem(items);
		if (stateRef.current.followsNewResponse && latestScrollableItem && (responding || responseJustFinished)) {
			followStreamingResponse(element, latestScrollableItem.id);
		}
		syncMessageScroller();
	}, [
		applyTailSpace,
		beginAnchoredScroll,
		cancelScheduledScroll,
		cancelStreamingScroll,
		followStreamingResponse,
		items,
		loading,
		responding,
		responseJustFinished,
		reducedMotion,
		ref,
		sessionId,
		syncMessageScroller,
	]);

	useLayoutEffect(() => {
		const tailSpaceChanged = committedTailSpaceRef.current !== tailSpace;
		committedTailSpaceRef.current = tailSpace;
		const element = ref.current;
		if (tailSpaceChanged && element && stateRef.current.followsNewResponse) {
			stateRef.current.expectedScrollTop = element.scrollTop;
		}
	}, [ref, tailSpace]);

	useLayoutEffect(() => {
		previousRespondingRef.current = responding;
	}, [responding]);

	useEffect(() => {
		const element = ref.current;
		if (!element || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => {
			const current = ref.current;
			if (!current) return;
			if (stateRef.current.followsNewResponse) stateRef.current.expectedScrollTop = current.scrollTop;
			const promptId = stateRef.current.lastUserMessageId;
			if (promptId) applyTailSpace(measureTailSpace(current, promptId, tailSpaceRef.current));
			const latestScrollableItem = lastScrollableTranscriptItem(itemsRef.current);
			if (respondingRef.current && stateRef.current.followsNewResponse && latestScrollableItem) {
				followStreamingResponse(current, latestScrollableItem.id);
			}
			syncMessageScroller();
		});
		observer.observe(element);
		if (element.firstElementChild) observer.observe(element.firstElementChild);
		return () => observer.disconnect();
	}, [applyTailSpace, followStreamingResponse, ref, syncMessageScroller]);

	useEffect(() => {
		return () => {
			scrollEpochRef.current += 1;
			if (promptScrollFrameRef.current !== undefined) cancelAnimationFrame(promptScrollFrameRef.current);
			if (streamingScrollFrameRef.current !== undefined) cancelAnimationFrame(streamingScrollFrameRef.current);
			if (anchorTimerRef.current) clearTimeout(anchorTimerRef.current);
			anchoringRef.current = false;
			nativeScrollActiveRef.current = false;
		};
	}, []);

	const onScroll = useCallback(() => {
		const element = ref.current;
		// A scrollTop that drifts from the last programmatic value while we're
		// following a streaming reply means the user grabbed the scrollbar (or
		// flung it) — release the follow so we stop fighting their scroll. The
		// anchoring window suppresses this during our own smooth scrolls.
		if (
			element &&
			stateRef.current.followsNewResponse &&
			!anchoringRef.current &&
			Math.abs(element.scrollTop - stateRef.current.expectedScrollTop) > 12
		) {
			stopFollowing();
		}
		syncMessageScroller();
	}, [ref, stopFollowing, syncMessageScroller]);

	const onWheel = useCallback(
		(event: WheelEvent<HTMLDivElement>) => {
			if (event.deltaY !== 0) stopFollowing();
		},
		[stopFollowing],
	);
	const onTouchMove = useCallback(
		(_event: TouchEvent<HTMLDivElement>) => {
			stopFollowing();
		},
		[stopFollowing],
	);
	const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
		if (event.button === 0) pointerStartRef.current = { x: event.clientX, y: event.clientY };
	}, []);
	const onPointerUp = useCallback(() => {
		pointerStartRef.current = undefined;
	}, []);
	const onPointerMove = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			const start = pointerStartRef.current;
			if (event.buttons === 0) {
				pointerStartRef.current = undefined;
				return;
			}
			if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4) return;
			pointerStartRef.current = undefined;
			stopFollowing();
		},
		[stopFollowing],
	);
	const onKeyDownCapture = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			if (isTranscriptScrollKey(event.key)) stopFollowing();
		},
		[stopFollowing],
	);

	return {
		onKeyDownCapture,
		onPointerDown,
		onPointerUp,
		onPointerMove,
		onScroll,
		onTouchMove,
		onWheel,
		tailSpace,
		scrollToBottom,
		showMessageScroller,
	};
}

function lastMessageForRole(
	items: readonly DesktopTranscriptItem[],
	role: "user" | "assistant",
): Extract<DesktopTranscriptItem, { readonly kind: "message" }> | undefined {
	for (let index = items.length - 1; index >= 0; index--) {
		const item = items[index];
		if (item?.kind === "message" && item.role === role) return item;
	}
	return undefined;
}

function lastScrollableTranscriptItem(items: readonly DesktopTranscriptItem[]): DesktopTranscriptItem | undefined {
	for (let index = items.length - 1; index >= 0; index--) {
		const item = items[index];
		if (!item) continue;
		if (item.kind === "message" && item.role === "assistant") return item;
		if (item.kind === "thinking" || item.kind === "narration" || item.kind === "tool" || item.kind === "subagent") {
			return item;
		}
	}
	return undefined;
}

function findTranscriptItemElement(element: HTMLDivElement, messageId: string): HTMLElement | undefined {
	return [...element.querySelectorAll<HTMLElement>("[data-transcript-item-id]")].find(
		(item) => item.dataset.transcriptItemId === messageId,
	);
}

/**
 * Height of the bottom spacer needed for `promptId` to rest at the top reading
 * position. Content coordinates are transform-immune, so this stays stable
 * regardless of the current scrollTop, and returns 0 once the reply below the
 * prompt already fills the viewport.
 */
function measureTailSpace(element: HTMLDivElement, promptId: string, currentTail: number): number {
	const prompt = findTranscriptItemElement(element, promptId);
	if (!prompt) return currentTail;
	const promptTop = element.scrollTop + prompt.getBoundingClientRect().top - element.getBoundingClientRect().top;
	const contentBelowPrompt = element.scrollHeight - currentTail - promptTop;
	const anchorOffset = element.clientHeight * transcriptPromptAnchorRatio;
	return Math.max(0, element.clientHeight - anchorOffset - contentBelowPrompt);
}

function scrollPromptIntoReadingPosition(
	element: HTMLDivElement,
	messageId: string,
	reducedMotion: boolean | null,
): void {
	const prompt = findTranscriptItemElement(element, messageId);
	if (!prompt) return;
	const promptTop = element.scrollTop + prompt.getBoundingClientRect().top - element.getBoundingClientRect().top;
	element.scrollTo({
		top: promptAnchorScrollTop(promptTop, element.clientHeight),
		behavior: reducedMotion ? "auto" : "smooth",
	});
}

function greeting(): string {
	const hour = new Date().getHours();
	if (hour < 12) return "Good morning";
	if (hour < 18) return "Good afternoon";
	return "Good evening";
}
