import { cn } from "cn";
import {
	type FocusEvent,
	type KeyboardEvent,
	type PointerEvent,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import {
	type ActiveTrailStore,
	computeDockTickStyles,
	computeFocusedTrailIndex,
	computeTrailGeometry,
	type MessageTrailItem,
	type TrailGeometry,
} from "./message-trail-logic";

interface MessageTrailProps {
	readonly items: readonly MessageTrailItem[];
	readonly activeStore: ActiveTrailStore;
	readonly onSelect: (itemId: string) => void;
}

const railWidth = 56;
const tickHitHeight = 10;
const tickOffset = 14;

export function MessageTrail({ items, activeStore, onSelect }: MessageTrailProps) {
	const intl = useIntl();
	const rootRef = useRef<HTMLElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const tooltipRef = useRef<HTMLDivElement>(null);
	const promptRef = useRef<HTMLDivElement>(null);
	const assistantRef = useRef<HTMLDivElement>(null);
	const tickRefs = useRef<Array<HTMLSpanElement | null>>([]);
	const frameRef = useRef<number | undefined>(undefined);
	const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const pointerYRef = useRef<number | null>(null);
	const focusIndexRef = useRef<number | null>(null);
	const tooltipIndexRef = useRef<number | null>(null);
	const [hasGutter, setHasGutter] = useState(false);
	const [rovingIndex, setRovingIndex] = useState(0);
	const tooltipId = useId();
	const snapshot = useSyncExternalStore(activeStore.subscribe, activeStore.getSnapshot, activeStore.getSnapshot);
	const geometry = useMemo(() => computeTrailGeometry(items.length), [items.length]);
	const visible = hasGutter && items.length > 1;
	const activeIndex = items.findIndex((item) => item.id === snapshot.currentId);
	const visibleIndexes = useMemo(
		() => new Set(items.flatMap((item, index) => (snapshot.visibleIds.includes(item.id) ? [index] : []))),
		[items, snapshot.visibleIds],
	);

	const applyRestStyles = () => {
		for (let index = 0; index < tickRefs.current.length; index += 1) {
			const tick = tickRefs.current[index];
			if (!tick) continue;
			tick.style.width = "6px";
			tick.style.opacity = `${index === activeIndex ? 0.9 : visibleIndexes.has(index) ? 0.52 : 0.2}`;
		}
	};

	const hideTooltip = () => {
		const tooltip = tooltipRef.current;
		if (!tooltip) return;
		tooltip.dataset.state = "closed";
		if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
		tooltipTimerRef.current = setTimeout(() => {
			if (tooltipRef.current?.dataset.state === "closed") tooltipRef.current.style.visibility = "hidden";
		}, 50);
	};

	const showTooltip = (index: number, currentGeometry: TrailGeometry) => {
		const tooltip = tooltipRef.current;
		const item = items[index];
		const viewport = viewportRef.current;
		if (!tooltip || !item || !viewport) return;
		if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
		if (tooltipIndexRef.current !== index) {
			tooltipIndexRef.current = index;
			if (promptRef.current) promptRef.current.textContent = item.promptPreview;
			if (assistantRef.current) {
				assistantRef.current.textContent = item.assistantPreview;
				assistantRef.current.style.display = item.assistantPreview ? "" : "none";
			}
		}
		const visibleY = currentGeometry.centerYs[index]! - viewport.scrollTop;
		const halfHeight = Math.max(28, tooltip.offsetHeight / 2 + 4);
		const clampedY = Math.max(
			halfHeight,
			Math.min(Math.max(halfHeight, viewport.clientHeight - halfHeight), visibleY),
		);
		tooltip.style.top = `${viewport.offsetTop + clampedY}px`;
		tooltip.style.visibility = "visible";
		tooltip.dataset.state = "open";
	};

	const renderMagnification = () => {
		frameRef.current = undefined;
		if (!visible || !geometry) return;
		const viewport = viewportRef.current;
		const localPointerY = pointerYRef.current;
		const focusedIndex =
			localPointerY === null
				? focusIndexRef.current
				: computeFocusedTrailIndex(localPointerY + (viewport?.scrollTop ?? 0), geometry);
		if (focusedIndex === null) {
			applyRestStyles();
			hideTooltip();
			return;
		}
		const pointerY =
			localPointerY === null ? geometry.centerYs[focusedIndex]! : localPointerY + (viewport?.scrollTop ?? 0);
		const styles = computeDockTickStyles(geometry, pointerY, focusedIndex, visibleIndexes);
		for (let index = 0; index < styles.length; index += 1) {
			const tick = tickRefs.current[index];
			const style = styles[index];
			if (!tick || !style) continue;
			tick.style.width = `${style.width}px`;
			tick.style.opacity = `${style.opacity}`;
		}
		showTooltip(focusedIndex, geometry);
	};

	const scheduleMagnification = () => {
		if (frameRef.current === undefined) frameRef.current = requestAnimationFrame(renderMagnification);
	};

	useEffect(() => {
		const root = rootRef.current;
		const pane = root?.parentElement;
		if (!pane || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() => setHasGutter(pane.clientWidth >= 864));
		observer.observe(pane);
		setHasGutter(pane.clientWidth >= 864);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!geometry) return;
		for (let index = 0; index < geometry.centerYs.length; index += 1) {
			const tick = tickRefs.current[index];
			if (!tick) continue;
			tick.style.width = "6px";
			tick.style.opacity = `${index === activeIndex ? 0.9 : visibleIndexes.has(index) ? 0.52 : 0.2}`;
		}
	}, [geometry, activeIndex, visibleIndexes]);

	useEffect(() => {
		if (!visible) {
			pointerYRef.current = null;
			focusIndexRef.current = null;
			const tooltip = tooltipRef.current;
			if (tooltip) {
				tooltip.dataset.state = "closed";
				tooltip.style.visibility = "hidden";
			}
		}
	}, [visible]);

	useEffect(() => {
		return () => {
			if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
			if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
		};
	}, []);

	const focusTick = (index: number) => {
		setRovingIndex(index);
		tickRefs.current[index]?.focus();
	};

	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		if (event.pointerType === "touch" || !visible) return;
		const bounds = viewportRef.current?.getBoundingClientRect();
		if (!bounds) return;
		pointerYRef.current = event.clientY - bounds.top;
		scheduleMagnification();
	};

	const onPointerLeave = (event: PointerEvent<HTMLDivElement>) => {
		if (event.pointerType === "touch") return;
		pointerYRef.current = null;
		if (focusIndexRef.current === null) {
			applyRestStyles();
			hideTooltip();
		} else {
			scheduleMagnification();
		}
	};

	const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
		const index = Math.max(0, Math.min(items.length - 1, rovingIndex));
		if (event.key === "ArrowDown") {
			event.preventDefault();
			focusTick(Math.min(items.length - 1, index + 1));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			focusTick(Math.max(0, index - 1));
		} else if (event.key === "Home") {
			event.preventDefault();
			focusTick(0);
		} else if (event.key === "End") {
			event.preventDefault();
			focusTick(items.length - 1);
		} else if (event.key === "Escape") {
			event.preventDefault();
			tickRefs.current[index]?.blur();
		}
	};

	const onBlur = (event: FocusEvent<HTMLElement>) => {
		if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return;
		focusIndexRef.current = null;
		if (pointerYRef.current === null) {
			applyRestStyles();
			hideTooltip();
		}
	};

	const tabStop = Math.max(0, Math.min(items.length - 1, rovingIndex));
	const railClassName = cn(
		"absolute inset-y-0 left-0 z-20 hidden flex-col justify-center min-[864px]:flex",
		visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
	);

	return (
		<nav
			ref={rootRef}
			aria-label={intl.formatMessage(desktopMessages.messageTrailNavigation)}
			aria-hidden={!visible}
			className={railClassName}
			style={{ width: railWidth }}
			onBlur={onBlur}
			onKeyDown={onKeyDown}
		>
			<div
				ref={viewportRef}
				className="relative max-h-[80%] w-full overflow-y-auto overscroll-contain scrollbar-none"
				onPointerEnter={onPointerMove}
				onPointerLeave={onPointerLeave}
				onPointerMove={onPointerMove}
				onScroll={scheduleMagnification}
			>
				<div className="relative w-full" style={{ height: geometry?.contentHeight ?? 0 }}>
					{items.map((item, index) => (
						<button
							key={item.id}
							type="button"
							tabIndex={visible && index === tabStop ? 0 : -1}
							aria-current={index === activeIndex ? "location" : undefined}
							aria-describedby={tooltipId}
							aria-label={intl.formatMessage(desktopMessages.messageTrailTick, {
								ordinal: item.ordinal,
								preview: item.promptPreview,
							})}
							className="absolute w-10 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
							style={{
								left: tickOffset - 6,
								top: geometry!.centerYs[index]! - tickHitHeight / 2,
								height: tickHitHeight,
							}}
							onClick={() => onSelect(item.id)}
							onFocus={() => {
								focusIndexRef.current = index;
								showTooltip(index, geometry!);
								scheduleMagnification();
							}}
						>
							<span
								ref={(element) => {
									tickRefs.current[index] = element;
								}}
								aria-hidden="true"
								className="absolute top-1/2 left-1.5 h-0.5 -translate-y-1/2 rounded-full bg-foreground transition-[width,opacity] duration-90 ease-out motion-reduce:transition-none"
								style={{ width: 6, opacity: 0.2, willChange: "width, opacity" }}
							/>
						</button>
					))}
				</div>
			</div>
			<div
				ref={tooltipRef}
				id={tooltipId}
				role="tooltip"
				data-state="closed"
				className="pointer-events-none invisible absolute left-16 z-30 w-64 -translate-y-1/2 rounded-xl border border-border/70 bg-popover p-2 shadow-lg opacity-0 scale-[0.98] transition-[opacity,scale] delay-80 duration-150 ease-out data-[state=closed]:scale-[0.98] data-[state=closed]:opacity-0 data-[state=closed]:delay-0 data-[state=closed]:duration-50 data-[state=open]:opacity-100 data-[state=open]:scale-100 motion-reduce:transition-none"
				style={{ top: 0 }}
			>
				<div ref={promptRef} className="line-clamp-2 text-xs leading-snug font-medium text-popover-foreground" />
				<div ref={assistantRef} className="mt-1 line-clamp-3 text-xs leading-snug text-muted-foreground" />
			</div>
		</nav>
	);
}
