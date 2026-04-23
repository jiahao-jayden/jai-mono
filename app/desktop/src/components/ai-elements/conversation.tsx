import { ArrowDownIcon, MessageSquareIcon } from "lucide-react";
import {
	type ComponentProps,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConversationProps = ComponentProps<"div"> & {
	/**
	 * Id of the most recent user message. When it changes during a live
	 * session, the container smoothly scrolls that message to ~24px below
	 * the viewport top — the assistant's response then streams in BELOW a
	 * stable reading anchor instead of chasing the viewport bottom.
	 */
	pinToMessageId?: string;
	/**
	 * Monotonic counter. Whenever it changes the conversation performs an
	 * instant (non-animated) jump to the bottom of real content — used for
	 * historical session loads where the pin-to-user-message animation
	 * would feel like unwanted auto-scroll.
	 */
	scrollToBottomToken?: number;
};

/** Distance from viewport top at which to park the pinned user message. */
const PIN_OFFSET_PX = 24;

export const Conversation = ({
	className,
	children,
	pinToMessageId,
	scrollToBottomToken,
	...props
}: ConversationProps) => {
	const scrollRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const [showScrollButton, setShowScrollButton] = useState(false);
	// Dynamic bottom spacer. Only activates DURING the current turn (between
	// the user sending a message and the assistant's response filling the
	// viewport). In historical sessions we want zero blank scroll area — so
	// the spacer stays at 0 unless `pinActive` is true.
	const [spacerHeight, setSpacerHeight] = useState(0);
	const [pinActive, setPinActive] = useState(false);
	const lastPinnedIdRef = useRef<string | null>(null);
	const lastBottomTokenRef = useRef<number | undefined>(undefined);

	const getContentBottomScrollTop = useCallback(() => {
		const el = scrollRef.current;
		const content = contentRef.current;
		if (!el) return 0;
		// Real content height excludes the bottom spacer (which is the last
		// child of scrollRef). `content.offsetHeight` is exactly that.
		const contentH = content?.offsetHeight ?? el.scrollHeight;
		return Math.max(0, contentH - el.clientHeight);
	}, []);

	const scrollToBottom = useCallback(
		(behavior: ScrollBehavior = "smooth") => {
			const el = scrollRef.current;
			if (!el) return;
			el.scrollTo({ top: getContentBottomScrollTop(), behavior });
		},
		[getContentBottomScrollTop],
	);

	const handleScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const bottom = getContentBottomScrollTop();
		const atBottom = bottom - el.scrollTop < 64;
		setShowScrollButton(!atBottom);
	}, [getContentBottomScrollTop]);

	// Recompute spacer whenever either the scroll container or the content
	// area resizes. The spacer is only "active" during a live turn (from the
	// moment the user sends a message until the assistant response has grown
	// to fill the viewport below it). Outside that window — historical loads,
	// idle state — we keep spacer at 0 so no blank scroll region can appear.
	useEffect(() => {
		const scrollEl = scrollRef.current;
		const contentEl = contentRef.current;
		if (!scrollEl || !contentEl) return;

		const update = () => {
			if (!pinActive) {
				setSpacerHeight((prev) => (prev === 0 ? prev : 0));
				return;
			}
			const containerH = scrollEl.clientHeight;
			if (containerH <= 0) return;

			const userMessages = contentEl.querySelectorAll<HTMLElement>(
				'[data-message-id][data-role="user"]',
			);
			const lastUser = userMessages[userMessages.length - 1];
			if (!lastUser) {
				setSpacerHeight(0);
				return;
			}

			const contentRect = contentEl.getBoundingClientRect();
			const lastUserRect = lastUser.getBoundingClientRect();
			// Distance from the user message's TOP (not bottom) to the
			// content bottom. This is what the pin math actually needs:
			//   pin target scrollTop = userTopOffset - PIN_OFFSET_PX
			//   max scrollTop        = contentH + spacer - containerH
			// Setting spacer so these two are EQUAL means the user cannot
			// keep scrolling past the pin — otherwise the user message
			// slides up into the top fade mask and looks "covered".
			const lastUserTopInContent = lastUserRect.top - contentRect.top;
			const belowUserTop = contentEl.offsetHeight - lastUserTopInContent;

			const needed = Math.max(0, containerH - PIN_OFFSET_PX - belowUserTop);
			setSpacerHeight((prev) => (Math.abs(prev - needed) < 1 ? prev : needed));
		};

		update();
		const ro = new ResizeObserver(update);
		ro.observe(scrollEl);
		ro.observe(contentEl);
		return () => ro.disconnect();
	}, [pinActive]);

	// Session switch / history load: jump to the bottom of real content
	// without animation. Also sync lastPinnedIdRef so the historical
	// last-user-message doesn't subsequently trigger a smooth pin animation.
	//
	// NOTE on cleanup: we intentionally do NOT cancel the rAF in cleanup.
	// React Strict Mode runs effects via mount → cleanup → re-mount; if the
	// rAF were cancelled in cleanup, the first run's rAF would die, and the
	// second run's ref guard would bail, so the scroll never happens. Since
	// all rAF callbacks re-read `scrollRef.current` and no-op when absent,
	// letting them fire is safe.
	useEffect(() => {
		if (scrollToBottomToken === undefined) return;
		if (scrollToBottomToken === lastBottomTokenRef.current) return;
		lastBottomTokenRef.current = scrollToBottomToken;
		lastPinnedIdRef.current = pinToMessageId ?? null;
		// Session-level load: any prior pin intent is stale, force spacer off.
		setPinActive(false);
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				const el = scrollRef.current;
				if (!el) return;
				el.scrollTo({
					top: getContentBottomScrollTop(),
					behavior: "instant" as ScrollBehavior,
				});
			});
		});
	}, [scrollToBottomToken, pinToMessageId, getContentBottomScrollTop]);

	// Pin the newest user message near the viewport top. rAF defers the
	// scroll so the spacer and new message DOM have laid out. Offset via
	// getBoundingClientRect — no dependence on offsetParent chain quirks.
	useEffect(() => {
		if (!pinToMessageId) return;
		if (pinToMessageId === lastPinnedIdRef.current) return;
		const id = pinToMessageId;
		lastPinnedIdRef.current = id;
		setPinActive(true);
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				const el = scrollRef.current;
				if (!el) return;
				const target = el.querySelector(`[data-message-id="${id}"]`);
				if (!(target instanceof HTMLElement)) return;
				const containerRect = el.getBoundingClientRect();
				const targetRect = target.getBoundingClientRect();
				const offsetWithin = targetRect.top - containerRect.top + el.scrollTop;
				const top = Math.max(0, offsetWithin - PIN_OFFSET_PX);
				el.scrollTo({ top, behavior: "instant" as ScrollBehavior });
			});
		});
	}, [pinToMessageId]);

	return (
		<div className="relative flex-1 min-h-0">
			<div
				ref={scrollRef}
				className={cn("h-full overflow-y-auto [overflow-anchor:none] [scrollbar-gutter:stable]", className)}
				onScroll={handleScroll}
				{...props}
			>
				<div ref={contentRef}>{children}</div>
				<div aria-hidden style={{ height: spacerHeight }} className="shrink-0" />
			</div>
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-linear-to-b from-background via-background/90 to-transparent"
			/>
			{showScrollButton && <ConversationScrollButton onClick={() => scrollToBottom()} />}
		</div>
	);
};

export type ConversationContentProps = ComponentProps<"div">;

export const ConversationContent = ({ className, children, ...props }: ConversationContentProps) => (
	<div className={cn("flex flex-col gap-6 p-4 md:p-8", className)} {...props}>
		{children}
	</div>
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
	icon?: ReactNode;
	title?: string;
	description?: string;
};

export const ConversationEmptyState = ({
	icon,
	title = "开始对话",
	description = "在下方输入消息开始与 Noa 交流",
	className,
	children,
	...props
}: ConversationEmptyStateProps) => (
	<div
		className={cn(
			"flex flex-col items-center justify-center gap-3 py-20 text-center text-muted-foreground",
			className,
		)}
		{...props}
	>
		<div className="text-muted-foreground/50">{icon ?? <MessageSquareIcon className="size-10" />}</div>
		<div className="space-y-1">
			<p className="text-sm font-medium text-foreground">{title}</p>
			<p className="text-xs">{description}</p>
		</div>
		{children}
	</div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({ className, ...props }: ConversationScrollButtonProps) => (
	<Button
		className={cn(
			"absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-md",
			className,
		)}
		size="icon-sm"
		variant="secondary"
		{...props}
	>
		<ArrowDownIcon className="size-4" />
	</Button>
);
