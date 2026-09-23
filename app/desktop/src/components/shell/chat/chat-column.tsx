import { cn } from "cn";
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
	useMemo,
	useRef,
	useState,
	type WheelEvent,
} from "react";
import { useIntl } from "react-intl";
import logo from "@/assets/icons/chat-area/logo-silver.svg";
import type { Chat } from "@/hooks/use-chat";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import type { QueuedMessage } from "@/stores/chat";
import type {
	CodingSession,
	DesktopAgentConnectionStatus,
	DesktopAgentMode,
	DesktopPermissionItem,
	DesktopProject,
	DesktopProviderConfigSnapshot,
	DesktopSubagentItem,
	DesktopTranscriptItem,
} from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { MessageScroller } from "../../ui/message-scroller";
import { PermissionRequests } from "../../ui/permission-requests";
import { toast } from "../../ui/toast";
import { COLLAPSED_CHAT_CONTENT_PADDING_CLASS, DESKTOP_TOP_BAR_HEIGHT_CLASS } from "../desktop-chrome";
import { SessionActions } from "../session-actions";
import { ChatComposer } from "./chat-composer";
import { groupTranscriptItems, TranscriptVirtualList, type TranscriptVirtualListHandle } from "./chat-transcript";
import { MessageTrail } from "./message-trail";
import {
	createActiveTrailStore,
	deriveMessageTrailAnchors,
	deriveMessageTrailItems,
	resolveActiveTrailSnapshot,
} from "./message-trail-logic";
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
	macTitleBar: boolean;
	onOpenProviderSettings(): void;
	onSelectProviderModel(modelRef: string): void;
	onSelectAgentMode(mode: DesktopAgentMode): void;
	onChooseProject(project: DesktopProject): Promise<void>;
	onRetryProjects(): void;
	onRenameSession(sessionId: string, title: string): Promise<void>;
	onArchiveSession(sessionId: string): Promise<void>;
	onDeleteSession(sessionId: string): Promise<void>;
	onOpenSubagent?(item: DesktopSubagentItem): void;
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
	macTitleBar,
	onOpenProviderSettings,
	onSelectProviderModel,
	onSelectAgentMode,
	onChooseProject,
	onRetryProjects,
	onRenameSession,
	onArchiveSession,
	onDeleteSession,
	onOpenSubagent,
}: ChatColumnProps) {
	const intl = useIntl();
	const icons = useIcons();
	const FolderIcon = icons.folder;
	const FolderOffIcon = icons["folder-off"];
	const MessageIcon = icons["message-circle"];
	const scrollRef = useRef<HTMLDivElement>(null);
	const transcriptListRef = useRef<TranscriptVirtualListHandle>(null);
	const openWorkGroupsRef = useRef(new Set<string>());
	const cancelTitleEditRef = useRef(false);
	const messageTrailScrollFrameRef = useRef<number | undefined>(undefined);
	const reducedMotion = useReducedMotion();
	const [editingTitle, setEditingTitle] = useState(false);
	const [titleDraft, setTitleDraft] = useState("");
	const [messageTrailStore] = useState(createActiveTrailStore);

	const isNewChat = !session;
	const sessionId = session?.id;
	const messageTrailSessionRef = useRef(sessionId);
	const showLogo = isNewChat || chat.isLoading;
	const logoLabel = isNewChat
		? intl.formatMessage(greetingMessage(), { name: "Jiahao" })
		: intl.formatMessage(desktopMessages.transcriptLoading);
	const isAgentWorking = chat.status === "submitted" || chat.status === "streaming" || chat.status === "stopping";
	const navigationDisabled = isAgentWorking || !selectedModelRef;
	const ensureTranscriptItemVisible = useCallback((itemId: string, behavior: ScrollBehavior = "auto") => {
		return transcriptListRef.current?.scrollToItem(itemId, behavior) ?? false;
	}, []);
	const pendingApprovals = useMemo(
		() =>
			chat.messages.filter(
				(item): item is DesktopPermissionItem => item.kind === "permission" && item.status === "pending",
			),
		[chat.messages],
	);
	const transcriptItems = useMemo(
		() =>
			pendingApprovals.length > 0
				? chat.messages.filter((item) => item.kind !== "permission" || item.status !== "pending")
				: chat.messages,
		[chat.messages, pendingApprovals],
	);
	const messageTrailItems = useMemo(() => deriveMessageTrailItems(transcriptItems), [transcriptItems]);
	const messageTrailAnchors = useMemo(
		() => deriveMessageTrailAnchors(groupTranscriptItems(transcriptItems)),
		[transcriptItems],
	);
	const onVisibleRowRangeChange = useCallback(
		(topRowIndex: number, bottomRowIndex: number) => {
			messageTrailStore.setSnapshot(resolveActiveTrailSnapshot(messageTrailAnchors, topRowIndex, bottomRowIndex));
		},
		[messageTrailAnchors, messageTrailStore],
	);
	const transcriptScroll = useTranscriptScroll({
		ref: scrollRef,
		sessionId,
		items: transcriptItems,
		loading: chat.isLoading,
		responding: isAgentWorking,
		reducedMotion,
		ensureItemVisible: ensureTranscriptItemVisible,
	});
	useLayoutEffect(() => {
		if (messageTrailSessionRef.current === sessionId) return;
		messageTrailSessionRef.current = sessionId;
		messageTrailStore.setSnapshot(null);
	});
	const jumpToMessageTrailItem = useCallback(
		(itemId: string) => {
			transcriptScroll.stopFollowing();
			const element = scrollRef.current;
			if (!element) return;
			if (messageTrailScrollFrameRef.current !== undefined) {
				cancelAnimationFrame(messageTrailScrollFrameRef.current);
			}
			const start = element.scrollTop;
			const animate = (target: number) => {
				if (reducedMotion) {
					element.scrollTop = target;
					return;
				}
				const distance = target - start;
				const duration = Math.min(650, 320 + Math.abs(distance) * 0.06);
				const startedAt = performance.now();
				const step = (timestamp: number) => {
					const progress = Math.min(1, (timestamp - startedAt) / duration);
					element.scrollTop = start + distance * (1 - (1 - progress) ** 3);
					if (progress < 1) messageTrailScrollFrameRef.current = requestAnimationFrame(step);
					else messageTrailScrollFrameRef.current = undefined;
				};
				messageTrailScrollFrameRef.current = requestAnimationFrame(step);
			};
			const prompt = findTranscriptItemElement(element, itemId);
			if (prompt) {
				const promptTop = start + prompt.getBoundingClientRect().top - element.getBoundingClientRect().top;
				animate(promptAnchorScrollTop(promptTop, element.clientHeight));
				return;
			}
			ensureTranscriptItemVisible(itemId);
			const startedAt = performance.now();
			const seekPrompt = () => {
				const mountedPrompt = findTranscriptItemElement(element, itemId);
				if (!mountedPrompt) {
					if (performance.now() - startedAt < 1_000) {
						messageTrailScrollFrameRef.current = requestAnimationFrame(seekPrompt);
					}
					return;
				}
				const promptTop =
					element.scrollTop + mountedPrompt.getBoundingClientRect().top - element.getBoundingClientRect().top;
				element.scrollTop = start;
				animate(promptAnchorScrollTop(promptTop, element.clientHeight));
			};
			messageTrailScrollFrameRef.current = requestAnimationFrame(seekPrompt);
		},
		[ensureTranscriptItemVisible, reducedMotion, transcriptScroll],
	);
	useEffect(
		() => () => {
			if (messageTrailScrollFrameRef.current !== undefined) {
				cancelAnimationFrame(messageTrailScrollFrameRef.current);
			}
		},
		[],
	);

	const toastedErrorKey = useRef<number | undefined>(undefined);
	const toastedProjectError = useRef<string | undefined>(undefined);
	useEffect(() => {
		if (!chat.error) {
			toastedErrorKey.current = undefined;
			return;
		}
		if (toastedErrorKey.current === chat.errorKey) return;
		toastedErrorKey.current = chat.errorKey;
		toast.add({ title: chat.error, type: "error" });
		chat.dismissError();
	}, [chat.dismissError, chat.error, chat.errorKey]);
	useEffect(() => {
		if (!projectError) {
			toastedProjectError.current = undefined;
			return;
		}
		if (toastedProjectError.current === projectError) return;
		toastedProjectError.current = projectError;
		toast.add({ title: projectError, type: "error" });
	}, [projectError]);

	const projectLabel =
		project?.displayName ??
		(projectLoading
			? intl.formatMessage(desktopMessages.chatProjectLoading)
			: projectLoadError
				? intl.formatMessage(desktopMessages.chatProjectsUnavailable)
				: null);

	const drag = { WebkitAppRegion: "drag" } as CSSProperties;
	const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;
	const logoMaskStyle = { "--logo-mask": `url("${logo}")` } as CSSProperties;
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
		} catch {
			toast.add({
				title: intl.formatMessage(desktopMessages.chatRenameFailed),
				description: intl.formatMessage(desktopMessages.chatRenameFailed),
				type: "error",
			});
		}
	};

	return (
		<section className="flex min-w-0 flex-1 flex-col">
			<header
				className={cn(
					"flex shrink-0 items-center justify-between pr-1.5",
					DESKTOP_TOP_BAR_HEIGHT_CLASS,
					sidebarOpen ? "pl-1.5" : macTitleBar ? COLLAPSED_CHAT_CONTENT_PADDING_CLASS : "pl-10",
				)}
				style={drag}
			>
				<div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden px-1.5 text-[13px]">
					{projectLabel ? (
						<>
							{project && !project.available ? (
								<FolderOffIcon size={16} className="shrink-0 text-destructive" />
							) : (
								<FolderIcon size={16} className="shrink-0 text-muted-foreground" />
							)}
							<span className="max-w-40 truncate font-medium text-surface-primary-foreground">
								{projectLabel}
							</span>
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
									aria-label={intl.formatMessage(desktopMessages.sessionTitle)}
									maxLength={80}
									className="h-7 min-w-0 max-w-64 flex-1 border-transparent bg-muted-hover px-1.25 py-0 text-[13px] leading-4.5 font-medium focus-visible:border-brand"
									style={noDrag}
								/>
							) : (
								<SessionActions
									key={session.id}
									session={session}
									running={isAgentWorking}
									onStartRename={startTitleEditing}
									onArchive={onArchiveSession}
									onDelete={onDeleteSession}
								>
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
										aria-label={intl.formatMessage(desktopMessages.chatEditSessionTitle, {
											title: session.title,
										})}
										title={intl.formatMessage(desktopMessages.chatRenameHint)}
										contentClassName="min-w-0 max-w-full"
										labelClassName="min-w-0 truncate text-left leading-[18px] ![text-box:normal]"
										className="h-7 min-w-0 max-w-64 shrink justify-start px-1.5 text-[13px] font-medium text-surface-primary-foreground hover:text-foreground"
										style={noDrag}
									>
										{session.title}
									</Button>
								</SessionActions>
							)}
						</>
					) : null}
				</div>
				{/* 右上角的任务卡片 / dock 开关由 AppShell 固定在内容卡片角上，这里只留出它们的位置。 */}
				<span className="h-8 w-16.5 shrink-0" aria-hidden="true" />
			</header>
			<RecoveryBanners
				connectionStatus={chat.connectionStatus}
				interrupted={chat.stopReason === "interrupted"}
				onRetryConnection={() => void chat.retryConnection()}
			/>

			{showLogo ? (
				<div className="flex min-h-0 flex-1 items-center justify-center" aria-label={logoLabel} role="img">
					<div className="relative size-20">
						<img src={logo} alt="" draggable={false} className="size-20 select-none" />
						{chat.isLoading ? (
							<span aria-hidden className="logo-scan motion-reduce:hidden" style={logoMaskStyle} />
						) : null}
					</div>
				</div>
			) : (
				<div className="relative min-h-0 flex-1">
					<div
						ref={scrollRef}
						className="h-full overflow-x-clip overflow-y-auto scrollbar-gutter-stable [overflow-anchor:none]"
						onKeyDownCapture={transcriptScroll.onKeyDownCapture}
						onPointerDown={transcriptScroll.onPointerDown}
						onPointerMove={transcriptScroll.onPointerMove}
						onPointerUp={transcriptScroll.onPointerUp}
						onPointerCancel={transcriptScroll.onPointerUp}
						onScroll={transcriptScroll.onScroll}
						onTouchMove={transcriptScroll.onTouchMove}
						onWheel={transcriptScroll.onWheel}
					>
						<TranscriptVirtualList
							ref={transcriptListRef}
							items={transcriptItems}
							runs={chat.runs}
							loading={chat.isLoading}
							responding={isAgentWorking}
							openWorkGroups={openWorkGroupsRef.current}
							workGroupKeyPrefix={session?.id}
							navigationDisabled={navigationDisabled}
							onNavigate={chat.navigate}
							onOpenSubagent={onOpenSubagent}
							scrollRef={scrollRef}
							tailSpace={transcriptScroll.tailSpace}
							emptyState={intl.formatMessage(desktopMessages.chatEmpty)}
							onVisibleRowRangeChange={onVisibleRowRangeChange}
						/>
					</div>
					<MessageTrail
						items={messageTrailItems}
						activeStore={messageTrailStore}
						onSelect={jumpToMessageTrailItem}
					/>
					<MessageScroller
						onScrollToBottom={transcriptScroll.scrollToBottom}
						visible={transcriptScroll.showMessageScroller}
					/>
				</div>
			)}
			<div className="relative shrink-0 px-5 pb-2">
				<div className="pointer-events-none absolute right-5 bottom-full left-5 z-10 mb-2">
					<AnimatePresence initial={false}>
						{pendingApprovals.length > 0 ? (
							<PermissionRequests
								key="permission-requests"
								requests={pendingApprovals.map((item) => ({
									id: item.request.requestId,
									title: item.request.summary.title,
									description: item.request.summary.description || item.request.reason,
									command: item.request.summary.command,
									path: item.request.summary.path,
									canAlwaysAllow: item.request.canAlwaysAllow ?? Boolean(item.request.suggestedRule),
								}))}
								onResolve={(requestId, decision) => chat.resolvePermission({ requestId, decision })}
							/>
						) : null}
					</AnimatePresence>
				</div>
				<div className="mx-auto flex w-full max-w-184 flex-col gap-2">
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
						onSteerQueuedMessage={chat.steerQueuedMessage}
						project={project}
						projects={projects}
						projectBusy={projectBusy}
						projectLoading={projectLoading}
						projectLoadError={projectLoadError}
						onChooseProject={onChooseProject}
						onRetryProjects={onRetryProjects}
						providerConfig={providerConfig}
						selectedModelRef={selectedModelRef}
						selectedAgentMode={selectedAgentMode}
						providerLoading={providerLoading}
						providerError={providerError}
						onOpenProviderSettings={onOpenProviderSettings}
						onSelectProviderModel={onSelectProviderModel}
						onSelectAgentMode={onSelectAgentMode}
						usage={chat.usage}
						showProjectPicker={isNewChat}
						large={isNewChat}
					/>
				</div>
			</div>
		</section>
	);
}

function RecoveryBanners({
	connectionStatus,
	interrupted,
	onRetryConnection,
}: {
	readonly connectionStatus: DesktopAgentConnectionStatus | undefined;
	readonly interrupted: boolean;
	onRetryConnection(): void;
}) {
	const intl = useIntl();
	const icons = useIcons();
	const RefreshIcon = icons["rotate-ccw"];
	const AlertIcon = icons["shield-alert"];
	if (!connectionStatus && !interrupted) return null;

	return (
		<>
			{connectionStatus ? (
				<div
					className="mx-4 mt-1 mb-2 flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[13px] text-amber-800 min-[1024px]:mx-8 dark:text-amber-200"
					role="alert"
					aria-live="polite"
				>
					{connectionStatus === "reconnecting" ? (
						<RefreshIcon size={16} className="shrink-0" />
					) : (
						<AlertIcon size={16} className="shrink-0" />
					)}
					<span className="min-w-0 flex-1">
						{intl.formatMessage(
							connectionStatus === "reconnecting"
								? desktopMessages.chatRecoveryReconnecting
								: desktopMessages.chatRecoveryRestartFailed,
						)}
					</span>
					{connectionStatus === "restart_failed" ? (
						<Button type="button" variant="tertiary" size="sm" onClick={onRetryConnection}>
							{intl.formatMessage(desktopMessages.chatRecoveryRetryConnection)}
						</Button>
					) : null}
				</div>
			) : null}
			{interrupted ? (
				<div
					className="mx-4 mt-1 mb-2 flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[13px] text-amber-800 min-[1024px]:mx-8 dark:text-amber-200"
					role="status"
					aria-live="polite"
				>
					<AlertIcon size={16} className="shrink-0" />
					<span className="min-w-0 flex-1">{intl.formatMessage(desktopMessages.chatRecoveryInterrupted)}</span>
				</div>
			) : null}
		</>
	);
}

interface TranscriptScrollOptions {
	ref: RefObject<HTMLDivElement | null>;
	sessionId?: string;
	items: readonly DesktopTranscriptItem[];
	loading: boolean;
	responding: boolean;
	reducedMotion: boolean | null;
	ensureItemVisible(itemId: string, behavior?: ScrollBehavior): boolean;
}

function useTranscriptScroll({
	ref,
	sessionId,
	items,
	loading,
	responding,
	reducedMotion,
	ensureItemVisible,
}: TranscriptScrollOptions) {
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
	const previousRespondingRef = useRef(responding);
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
			applyTailSpace(measureTailSpace(element, promptId, tailSpaceRef.current, ensureItemVisible));
			setShowMessageScroller(false);
			// Anchor the prompt to the top only after the spacer's height commits:
			// scrolling now would clamp against the stale, spacer-less scrollHeight.
			if (promptScrollFrameRef.current !== undefined) cancelAnimationFrame(promptScrollFrameRef.current);
			const scrollEpoch = scrollEpochRef.current;
			const promptAnchorStartedAt = performance.now();
			const seekPrompt = () => {
				promptScrollFrameRef.current = undefined;
				const current = ref.current;
				if (!current || scrollEpoch !== scrollEpochRef.current || stateRef.current.sessionId !== sessionId) return;
				if (!scrollPromptIntoReadingPosition(current, promptId, reducedMotion, ensureItemVisible)) {
					if (performance.now() - promptAnchorStartedAt < 1_000) {
						promptScrollFrameRef.current = requestAnimationFrame(seekPrompt);
					}
					return;
				}
				beginAnchoredScroll();
			};
			promptScrollFrameRef.current = requestAnimationFrame(seekPrompt);
			return;
		}

		// Keep the spacer sized to exactly what the latest prompt needs to sit at
		// the top: it shrinks to zero as a long reply fills the viewport, and
		// holds just enough for a short reply so the prompt never drops back down.
		const promptId = stateRef.current.lastUserMessageId;
		if (promptId) applyTailSpace(measureTailSpace(element, promptId, tailSpaceRef.current, ensureItemVisible));

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
		ensureItemVisible,
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
		const observer = new ResizeObserver(syncMessageScroller);
		observer.observe(element);
		if (element.firstElementChild) observer.observe(element.firstElementChild);
		return () => observer.disconnect();
	}, [ref, syncMessageScroller]);

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
	const onPointerDown = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			if (event.button === 0) pointerStartRef.current = { x: event.clientX, y: event.clientY };
			if (event.target instanceof Element && event.target.closest("[data-slot='collapsible-trigger']")) {
				stopFollowing();
			}
		},
		[stopFollowing],
	);
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
		stopFollowing,
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
function measureTailSpace(
	element: HTMLDivElement,
	promptId: string,
	currentTail: number,
	ensureItemVisible: (itemId: string) => boolean,
): number {
	const prompt = findTranscriptItemElement(element, promptId);
	if (!prompt) ensureItemVisible(promptId);
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
	ensureItemVisible: (itemId: string, behavior?: ScrollBehavior) => boolean,
): boolean {
	const prompt = findTranscriptItemElement(element, messageId);
	if (!prompt) {
		ensureItemVisible(messageId, reducedMotion ? "auto" : "smooth");
		return false;
	}
	const promptTop = element.scrollTop + prompt.getBoundingClientRect().top - element.getBoundingClientRect().top;
	element.scrollTo({
		top: promptAnchorScrollTop(promptTop, element.clientHeight),
		behavior: reducedMotion ? "auto" : "smooth",
	});
	return true;
}

function greetingMessage() {
	const hour = new Date().getHours();
	if (hour < 12) return desktopMessages.chatMorning;
	if (hour < 18) return desktopMessages.chatAfternoon;
	return desktopMessages.chatEvening;
}
