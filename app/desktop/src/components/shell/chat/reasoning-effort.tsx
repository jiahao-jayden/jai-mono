import { cn } from "cn";
import { type PointerEvent as ReactPointerEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import type { DesktopReasoningLevel } from "../../../../shared/session-controls";
import { ReasoningFire } from "./reasoning-fire";

// Matches the model popover content width (260px minus px-4 on both sides).
const TRACK = 228;
const HEIGHT = 32;
const RADIUS = HEIGHT / 2;
const BUMP_H = 20;
const REST_W = 27.2;
const DRAG_W = 33.6;
const REST_H = 27.2;
const EDGE_PAD = (HEIGHT - REST_H) / 2;

const SHELL_VARS = {
	light: {
		"--ss-shell": "rgba(230, 230, 232, 0.504)",
		"--ss-shell-2": "rgba(232, 232, 233, 0.357)",
		"--ss-line": "rgba(0, 0, 0, 0.084)",
		"--ss-label": "#1d1d1d",
		"--ss-label-dim": "rgba(29, 29, 29, 0.4)",
		"--ss-tick": "rgba(0, 0, 0, 0.176)",
		"--ss-thumb-shadow": "0 1px 1px rgba(0, 0, 0, 0.1)",
	},
	dark: {
		"--ss-shell": "rgba(255, 255, 255, 0.07)",
		"--ss-shell-2": "rgba(255, 255, 255, 0.1)",
		"--ss-line": "rgba(255, 255, 255, 0.08)",
		"--ss-label": "#ffffff",
		"--ss-label-dim": "rgba(255, 255, 255, 0.4)",
		"--ss-tick": "rgba(255, 255, 255, 0.256)",
		"--ss-thumb-shadow": "0 1px 1px rgba(0, 0, 0, 0.18)",
	},
} as const;

function clamp(n: number, min: number, max: number) {
	return Math.min(max, Math.max(min, n));
}

function centerFor(value: number, stopCount: number) {
	const span = TRACK - RADIUS * 2;
	return RADIUS + (value / Math.max(1, stopCount - 1)) * span;
}

function easeOut(t: number) {
	return 1 - (1 - t) ** 3;
}

const LEFT_SHOULDER = 23.572;
const TEXT_SIDE = 20;
const PHI_MAX = 0.6;
const PHI_REACH = 36;

function plateauFor(textW: number) {
	return Math.max(8, textW + TEXT_SIDE * 2 - LEFT_SHOULDER * 2);
}

function smoothstep(t: number) {
	const x = clamp(t, 0, 1);
	return x * x * (3 - 2 * x);
}

function capFoot(side: -1 | 1, phi: number) {
	const crown = side === -1 ? RADIUS : TRACK - RADIUS;
	return {
		x: crown + side * RADIUS * Math.sin(phi),
		y: BUMP_H + RADIUS * (1 - Math.cos(phi)),
	};
}

function shellGeom(cx: number, plateauW: number) {
	const crownL = RADIUS;
	const crownR = TRACK - RADIUS;
	let topL = cx - plateauW / 2;
	let topR = topL + plateauW;
	let phiL = 0;
	let phiR = 0;

	const overflowL = crownL - (topL - LEFT_SHOULDER);
	if (overflowL > 0) {
		phiL = PHI_MAX * smoothstep(overflowL / PHI_REACH);
		const foot = capFoot(-1, phiL);
		const minTopL = foot.x + LEFT_SHOULDER * Math.cos(phiL);
		if (topL < minTopL) {
			topR += minTopL - topL;
			topL = minTopL;
		}
	}

	const overflowR = topR + LEFT_SHOULDER - crownR;
	if (overflowR > 0) {
		phiR = PHI_MAX * smoothstep(overflowR / PHI_REACH);
		const foot = capFoot(1, phiR);
		const maxTopR = foot.x - LEFT_SHOULDER * Math.cos(phiR);
		if (topR > maxTopR) {
			topL -= topR - maxTopR;
			topR = maxTopR;
		}
	}

	const insetL = phiL > 0 ? LEFT_SHOULDER * (1 - Math.cos(phiL)) : 0;
	const insetR = phiR > 0 ? LEFT_SHOULDER * (1 - Math.cos(phiR)) : 0;
	topR += insetL;
	topL -= insetR;

	return { topL, topR, phiL, phiR, insetL, insetR };
}

function shoulderCmds(footX: number, footY: number, platX: number, platY: number, phi: number, dir: 1 | -1) {
	const xScale = Math.abs(platX - footX) / LEFT_SHOULDER;
	const yScale = Math.max(0.001, (footY - platY) / 20);
	const tangent = { x: dir * Math.cos(phi), y: -Math.sin(phi) };
	const map = (lx: number, ly: number) => ({
		x: footX + dir * lx * xScale,
		y: footY + (ly - 20) * yScale,
	});
	const h1 = 5.398 * xScale;
	const p0 = { x: footX, y: footY };
	const c1 = { x: footX + tangent.x * h1, y: footY + tangent.y * h1 };
	const c2 = map(10.012, 16.114);
	const p1 = map(10.93, 10.794);
	const c3 = map(11.916, 4.577);
	const c4 = map(17.277, 0);
	const p3 = { x: platX, y: platY };
	const fmt = (p: { x: number; y: number }) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
	if (dir === 1) return `C${fmt(c1)} ${fmt(c2)} ${fmt(p1)}C${fmt(c3)} ${fmt(c4)} ${fmt(p3)}`;
	return `C${fmt(c4)} ${fmt(c3)} ${fmt(p1)}C${fmt(c2)} ${fmt(c1)} ${fmt(p0)}`;
}

function shellPath(cx: number, open: number, plateauW: number) {
	const trackTop = BUMP_H;
	const trackBot = BUMP_H + HEIGHT;
	const crownL = RADIUS;
	const crownR = TRACK - RADIUS;
	if (open < 0.012) {
		return `M${crownL} ${trackTop}H${crownR}A${RADIUS} ${RADIUS} 0 0 1 ${crownR} ${trackBot}H${crownL}A${RADIUS} ${RADIUS} 0 0 1 ${crownL} ${trackTop}Z`;
	}

	const bumpTop = BUMP_H * (1 - open);
	const { topL, topR, phiL, phiR } = shellGeom(cx, plateauW);
	const cmds = [`M${crownL} ${trackBot}`];

	if (phiL > 0.001) {
		const foot = capFoot(-1, phiL);
		cmds.push(`A${RADIUS} ${RADIUS} 0 0 1 ${foot.x.toFixed(2)} ${foot.y.toFixed(2)}`);
		cmds.push(shoulderCmds(foot.x, foot.y, topL, bumpTop, phiL, 1));
	} else {
		cmds.push(`A${RADIUS} ${RADIUS} 0 0 1 ${crownL} ${trackTop}`);
		const footL = topL - LEFT_SHOULDER;
		if (footL > crownL + 0.4) cmds.push(`H${footL.toFixed(2)}`);
		cmds.push(shoulderCmds(footL, trackTop, topL, bumpTop, 0, 1));
	}

	if (topR > topL + 0.4) cmds.push(`H${topR.toFixed(2)}`);

	if (phiR > 0.001) {
		const foot = capFoot(1, phiR);
		cmds.push(shoulderCmds(foot.x, foot.y, topR, bumpTop, phiR, -1));
		cmds.push(`A${RADIUS} ${RADIUS} 0 0 1 ${crownR} ${trackBot}`);
	} else {
		const footR = topR + LEFT_SHOULDER;
		cmds.push(shoulderCmds(footR, trackTop, topR, bumpTop, 0, -1));
		if (footR < crownR - 0.4) cmds.push(`H${crownR}`);
		cmds.push(`A${RADIUS} ${RADIUS} 0 0 1 ${crownR} ${trackBot}`);
	}

	cmds.push(`H${crownL}Z`);
	return cmds.join("");
}

interface ReasoningEffortProps {
	readonly levels: readonly DesktopReasoningLevel[];
	readonly value: DesktopReasoningLevel | undefined;
	readonly disabled?: boolean;
	onChange(value: DesktopReasoningLevel): void;
}

const levelMessages: Readonly<Record<DesktopReasoningLevel, (typeof desktopMessages)[keyof typeof desktopMessages]>> = {
	none: desktopMessages.reasoningLevelNone,
	minimal: desktopMessages.reasoningLevelMinimal,
	low: desktopMessages.reasoningLevelLow,
	medium: desktopMessages.reasoningLevelMedium,
	high: desktopMessages.reasoningLevelHigh,
	xhigh: desktopMessages.reasoningLevelXhigh,
	max: desktopMessages.reasoningLevelMax,
};

export function ReasoningEffort({ levels, value, disabled = false, onChange }: ReasoningEffortProps) {
	const intl = useIntl();
	const stops = levels.map((level) => intl.formatMessage(levelMessages[level]));
	const stopCount = Math.max(1, levels.length);
	const valueIndex = Math.max(0, levels.indexOf(value ?? levels[0]!));
	const rootRef = useRef<HTMLDivElement>(null);
	const trackRef = useRef<HTMLDivElement>(null);
	const labelRef = useRef<HTMLDivElement>(null);
	const valueRef = useRef(1);
	const displayRef = useRef(1);
	const openRef = useRef(0);
	const draggingRef = useRef(false);
	const [display, setDisplay] = useState(valueIndex);
	const [open, setOpen] = useState(0);
	const [dragging, setDragging] = useState(false);
	const [theme, setTheme] = useState<"light" | "dark">("light");
	const [textW, setTextW] = useState(64);
	const plateauTarget = plateauFor(textW);
	const plateauRef = useRef(plateauTarget);
	const [plateauW, setPlateauW] = useState(plateauTarget);
	const revealRef = useRef(0);
	const [reveal, setReveal] = useState(0);
	const gradId = useId().replace(/:/g, "");

	useEffect(() => {
		valueRef.current = valueIndex;
		displayRef.current = valueIndex;
		setDisplay(valueIndex);
	}, [valueIndex]);

	useLayoutEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		const read = () => {
			if (el.closest(".dark")) {
				setTheme("dark");
				return;
			}
			setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
		};
		read();
		const observer = new MutationObserver(read);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		media.addEventListener("change", read);
		return () => {
			observer.disconnect();
			media.removeEventListener("change", read);
		};
	}, []);

	useEffect(() => {
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const toOpen = dragging ? 1 : 0;
		const fromOpen = openRef.current;
		const fromValue = displayRef.current;
		const targetValue = dragging ? fromValue : Math.round(valueRef.current);
		if (reduce) {
			openRef.current = toOpen;
			setOpen(toOpen);
			if (!dragging) {
				valueRef.current = targetValue;
				displayRef.current = targetValue;
				setDisplay(targetValue);
			}
			return;
		}
		const start = performance.now();
		let raf = 0;
		const step = (now: number) => {
			const t = Math.min(1, (now - start) / 220);
			const e = easeOut(t);
			const nextOpen = fromOpen + (toOpen - fromOpen) * e;
			openRef.current = nextOpen;
			setOpen(nextOpen);
			if (!dragging) {
				const nextValue = fromValue + (targetValue - fromValue) * e;
				displayRef.current = nextValue;
				setDisplay(nextValue);
				if (t === 1) {
					valueRef.current = targetValue;
					displayRef.current = targetValue;
				}
			}
			if (t < 1) raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	}, [dragging]);

	useEffect(() => {
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const from = plateauRef.current;
		const to = plateauTarget;
		if (reduce || Math.abs(to - from) < 0.3) {
			plateauRef.current = to;
			setPlateauW(to);
			return;
		}
		const start = performance.now();
		let raf = 0;
		const step = (now: number) => {
			const t = Math.min(1, (now - start) / 90);
			const next = from + (to - from) * easeOut(t);
			plateauRef.current = next;
			setPlateauW(next);
			if (t < 1) raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	}, [plateauTarget]);

	useEffect(() => {
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const to = dragging ? 1 : 0;
		const from = revealRef.current;
		if (reduce) {
			revealRef.current = to;
			setReveal(to);
			return;
		}
		const delay = dragging ? 85 : 0;
		const dur = dragging ? 132 : 90;
		const start = performance.now();
		let raf = 0;
		const step = (now: number) => {
			const elapsed = now - start - delay;
			if (elapsed < 0) {
				raf = requestAnimationFrame(step);
				return;
			}
			const t = Math.min(1, elapsed / dur);
			const next = from + (to - from) * easeOut(t);
			revealRef.current = next;
			setReveal(next);
			if (t < 1) raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => cancelAnimationFrame(raf);
	}, [dragging]);

	function commit(next: number) {
		const index = Math.round(clamp(next, 0, stopCount - 1));
		valueRef.current = index;
		displayRef.current = index;
		setDisplay(index);
		const level = levels[index];
		if (level !== undefined) onChange(level);
	}

	function valueFrom(clientX: number) {
		const rect = trackRef.current?.getBoundingClientRect();
		if (!rect) return valueRef.current;
		const t = (clientX - rect.left - RADIUS) / (rect.width - RADIUS * 2);
		return clamp(t * (stopCount - 1), 0, stopCount - 1);
	}

	function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
		if (disabled || event.button !== 0) return;
		draggingRef.current = true;
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			/* Pointer capture needs a trusted event. */
		}
		setDragging(true);
		commit(valueFrom(event.clientX));
	}

	function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
		if (!draggingRef.current) return;
		commit(valueFrom(event.clientX));
	}

	function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
		if (!draggingRef.current) return;
		draggingRef.current = false;
		try {
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
		} catch {
			/* Ignore when the event was not trusted. */
		}
		setDragging(false);
	}

	function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
		if (disabled) return;
		const max = stopCount - 1;
		const current = Math.round(valueRef.current);
		let next = current;
		if (event.key === "ArrowRight" || event.key === "ArrowUp") next = Math.min(max, current + 1);
		else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = Math.max(0, current - 1);
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = max;
		else return;
		event.preventDefault();
		commit(next);
	}

	const center = centerFor(display, stopCount);
	const thumbW = REST_W + (DRAG_W - REST_W) * open;
	const thumbH = REST_H;
	const outerPad = EDGE_PAD;
	let thumbLeft = center - thumbW / 2;
	let thumbRight = thumbLeft + thumbW;
	if (thumbLeft < outerPad) {
		thumbLeft = outerPad;
		thumbRight = thumbLeft + thumbW;
	}
	if (thumbRight > TRACK - outerPad) {
		thumbRight = TRACK - outerPad;
		thumbLeft = thumbRight - thumbW;
	}
	const fillW = Math.min(TRACK, thumbRight + EDGE_PAD);
	const fillOpacity = clamp(display, 0, 1);
	const active = Math.round(display);
	const atMax = stopCount > 1 && active === stopCount - 1 && !disabled;
	const level = stops[active] ?? "";
	const displayLevel = value === undefined ? intl.formatMessage(desktopMessages.reasoningLevelDefault) : level;
	const tickHeights = levels.map((_, index) => 4.8 + (4.8 * index) / Math.max(1, stopCount - 1));
	const plateau = shellGeom(center, plateauW);
	const labelX = (plateau.topL + plateau.topR) / 2 + (plateau.insetL - plateau.insetR) / 2;

	// biome-ignore lint/correctness/useExhaustiveDependencies: level and theme trigger re-measure when label text or font rendering changes
	useLayoutEffect(() => {
		const w = labelRef.current?.getBoundingClientRect().width ?? 0;
		if (w > 0 && Math.abs(w - textW) > 0.4) setTextW(w);
	}, [level, theme, textW]);

	return (
		<div
			ref={rootRef}
			className="relative h-8 select-none touch-none font-[inherit]"
			style={{ ...SHELL_VARS[theme], width: TRACK } as React.CSSProperties}
			data-dragging={dragging ? "true" : "false"}
		>
			{/* The drag bump rises above the track and overlays the content above instead of reserving blank space. */}
			<svg
				className="pointer-events-none absolute inset-x-0 bottom-0 overflow-visible"
				width={TRACK}
				height={BUMP_H + HEIGHT}
				viewBox={`0 0 ${TRACK} ${BUMP_H + HEIGHT}`}
				aria-hidden
			>
				<defs>
					<linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0" stopColor="var(--ss-shell)" />
						<stop offset="1" stopColor="var(--ss-shell-2)" />
					</linearGradient>
				</defs>
				<path
					d={shellPath(center, open, plateauW)}
					fill={`url(#${gradId})`}
					stroke="var(--ss-line)"
					strokeWidth="0.5"
					strokeLinejoin="round"
					vectorEffect="non-scaling-stroke"
				/>
			</svg>
			<div
				ref={labelRef}
				className="pointer-events-none absolute -top-[17.5px] z-[2] text-[10.5px] font-medium leading-[14px] tracking-[-0.01em] whitespace-nowrap"
				style={{
					left: labelX,
					opacity: reveal,
					filter: reveal > 0.98 ? undefined : `blur(${((1 - reveal) * 3).toFixed(2)}px)`,
					transform: `translate(-50%, ${3 * (1 - open)}px)`,
				}}
			>
				<span key={level} className="flex animate-[ss-blur-in_180ms_ease-out] gap-[3px]">
					<span className="text-[color:var(--ss-label)]">
						{intl.formatMessage(desktopMessages.reasoningLevelLabel)}
					</span>
					<span className="text-[color:var(--ss-label-dim)]">{displayLevel}</span>
				</span>
			</div>
			<div
				ref={trackRef}
				role="slider"
				tabIndex={0}
				aria-label={intl.formatMessage(desktopMessages.reasoningLevelLabel)}
				aria-disabled={disabled}
				aria-valuetext={displayLevel}
				aria-valuemin={0}
				aria-valuemax={levels.length - 1}
				aria-valuenow={active}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				onPointerCancel={onPointerUp}
				onKeyDown={onKeyDown}
				className={cn(
					"absolute bottom-0 left-0 right-0 h-8 cursor-grab rounded-2xl outline-none focus-visible:outline-2 focus-visible:outline-[#006aff] focus-visible:outline-offset-[3px]",
					dragging && "cursor-grabbing",
					disabled && "pointer-events-none opacity-50",
				)}
			>
				<div
					className="pointer-events-none absolute bottom-0 left-0 top-0 rounded-2xl bg-[linear-gradient(90deg,#006aff,#0059d4)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.16)]"
					style={{ width: fillW, opacity: fillOpacity }}
				/>
				{atMax ? (
					<ReasoningFire className="pointer-events-none absolute inset-0 size-full rounded-2xl mix-blend-screen" />
				) : null}
				<div
					className="pointer-events-none absolute top-1/2 z-[2] rounded-full bg-[linear-gradient(180deg,#ffffff,#f5f5f5)] shadow-[var(--ss-thumb-shadow)]"
					style={{ left: thumbLeft, width: thumbW, height: thumbH, marginTop: -thumbH / 2 }}
				/>
				{stops.map((label, index) => {
					const x = centerFor(index, stopCount);
					const onThumb = x >= thumbLeft + 0.5 && x <= thumbRight - 0.5;
					return (
						<span
							key={label}
							className={cn(
								"pointer-events-none absolute top-1/2 z-[3] w-[1.5px] -ml-[0.75px] -translate-y-1/2 rounded-[1px] bg-[color:var(--ss-tick)]",
								onThumb && "bg-black/45",
								index === active && !onThumb && "bg-[#66a6ff]",
							)}
							style={{ left: x, height: tickHeights[index] }}
						/>
					);
				})}
			</div>
		</div>
	);
}
