import type { CodingSession } from "@jai/coding/business";
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
	rightPanelOpen: boolean;
	onToggleSidebar(): void;
	onToggleRightPanel(): void;
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
	rightPanelOpen,
	onToggleSidebar,
	onToggleRightPanel,
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
	const transcriptItems =
		pendingPermissions.length > 0
			? chat.messages.filter((item) => item.kind !== "permission" || item.status !== "pending")
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
							onScroll={transcriptScroll.onScroll}
							onTouchMove={transcriptScroll.onTouchMove}
							onWheel={transcriptScroll.onWheel}
						>
							<div className="px-5">
								<div className="mx-auto flex w-full max-w-190 flex-col gap-2 py-5">
									{chat.isLoading ? <TranscriptLoading /> : null}
									{!chat.isLoading && chat.messages.length === 0 ? (
										<p className="py-16 text-center text-[13px] text-muted-foreground">这个会话还没有消息。</p>
									) : null}
									<TranscriptItems items={transcriptItems} loading={chat.isLoading} />
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
								{pendingPermissions.length > 0 ? (
									<PermissionRequests
										key="permission-requests"
										requests={pendingPermissions.map((item) => ({
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
							<div className="relative">
								{isAgentWorking ? (
									<div
										className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 flex items-center gap-2 rounded-full bg-background px-2.5 py-1 shadow-surface-2"
										role="status"
									>
										<ThinkingOrb aria-hidden size={20} state="solving" />
										<span className="shimmer-text text-[12px] font-medium">Agent 正在处理…</span>
									</div>
								) : null}
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
							</div>
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
	const promptScrollFrameRef = useRef<number | undefined>(undefined);
	const streamingScrollFrameRef = useRef<number | undefined>(undefined);
	const streamingScrollTargetRef = useRef(0);
	const streamingScrollTimestampRef = useRef<number | undefined>(undefined);
	const anchoringRef = useRef(false);
	const anchorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const [showMessageScroller, setShowMessageScroller] = useState(false);
	const pointerStartRef = useRef<{ x: number; y: number } | undefined>(undefined);

	// Marks a stretch of programmatic smooth scrolling (prompt anchoring, jump
	// to bottom) so onScroll's user-scroll detector doesn't mistake the
	// in-flight animation frames for a manual scroll and detach mid-glide.
	const beginAnchoredScroll = useCallback(() => {
		anchoringRef.current = true;
		if (anchorTimerRef.current) clearTimeout(anchorTimerRef.current);
		anchorTimerRef.current = setTimeout(() => {
			anchoringRef.current = false;
			anchorTimerRef.current = undefined;
			const element = ref.current;
			if (element) stateRef.current.expectedScrollTop = element.scrollTop;
		}, 600);
	}, [ref]);

	const applyTailSpace = useCallback((next: number) => {
		tailSpaceRef.current = next;
		setTailSpace((current) => (Math.abs(current - next) < 1 ? current : next));
	}, []);

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
		(element: HTMLDivElement, messageId: string) => {
			const response = findTranscriptItemElement(element, messageId);
			if (!response) return;
			const responseBottom =
				element.scrollTop + response.getBoundingClientRect().bottom - element.getBoundingClientRect().top;
			const target = Math.min(
				comfortableScrollTop(element.scrollTop, element.clientHeight, responseBottom),
				element.scrollHeight - element.clientHeight,
			);
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
		[reducedMotion, ref],
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
		stateRef.current.followsNewResponse = false;
		cancelStreamingScroll();
		const element = ref.current;
		if (element) element.scrollTo({ top: element.scrollTop, behavior: "auto" });
	}, [cancelStreamingScroll, ref]);

	const scrollToBottom = useCallback(() => {
		const element = ref.current;
		if (!element) return;
		cancelStreamingScroll();
		stateRef.current.followsNewResponse = true;
		setShowMessageScroller(false);
		beginAnchoredScroll();
		element.scrollTo({
			top: element.scrollHeight,
			behavior: reducedMotion ? "auto" : "smooth",
		});
	}, [beginAnchoredScroll, cancelStreamingScroll, reducedMotion, ref]);

	useLayoutEffect(() => {
		if (stateRef.current.sessionId !== sessionId) {
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
			cancelStreamingScroll();
			const promptId = latestUser.id;
			stateRef.current.lastUserMessageId = promptId;
			stateRef.current.followsNewResponse = true;
			applyTailSpace(measureTailSpace(element, promptId, tailSpaceRef.current));
			setShowMessageScroller(false);
			// Anchor the prompt to the top only after the spacer's height commits:
			// scrolling now would clamp against the stale, spacer-less scrollHeight.
			if (promptScrollFrameRef.current !== undefined) cancelAnimationFrame(promptScrollFrameRef.current);
			promptScrollFrameRef.current = requestAnimationFrame(() => {
				promptScrollFrameRef.current = undefined;
				const current = ref.current;
				if (!current) return;
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

		const latestAssistant = lastMessageForRole(items, "assistant");
		if (responding && stateRef.current.followsNewResponse && latestAssistant?.status === "streaming") {
			followStreamingResponse(element, latestAssistant.id);
		}
		syncMessageScroller();
	}, [
		applyTailSpace,
		beginAnchoredScroll,
		cancelStreamingScroll,
		followStreamingResponse,
		items,
		loading,
		responding,
		reducedMotion,
		ref,
		sessionId,
		syncMessageScroller,
	]);

	useEffect(() => {
		return () => {
			if (promptScrollFrameRef.current !== undefined) cancelAnimationFrame(promptScrollFrameRef.current);
			if (streamingScrollFrameRef.current !== undefined) cancelAnimationFrame(streamingScrollFrameRef.current);
			if (anchorTimerRef.current) clearTimeout(anchorTimerRef.current);
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
		(_event: WheelEvent<HTMLDivElement>) => {
			stopFollowing();
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
		pointerStartRef.current = { x: event.clientX, y: event.clientY };
	}, []);
	const onPointerMove = useCallback(
		(event: PointerEvent<HTMLDivElement>) => {
			const start = pointerStartRef.current;
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
