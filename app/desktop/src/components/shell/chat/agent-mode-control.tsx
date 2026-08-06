"use client";

import { useReducedMotion } from "framer-motion";
import type { PointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type { IconName } from "@/lib/icon-context";
import { useIcons } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { DesktopAgentMode } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { DropdownContent, DropdownMenu, DropdownTrigger } from "../../ui/dropdown";
import { MenuItem } from "../../ui/menu-item";

interface AgentModeMeta {
	readonly color: string;
	readonly icon: IconName;
	readonly label: string;
	readonly status: string;
}

const agentModes: readonly DesktopAgentMode[] = ["manual", "automate", "plan"];

const agentModeMeta: Readonly<Record<DesktopAgentMode, AgentModeMeta>> = {
	manual: {
		color: "#8a6b3f",
		icon: "user",
		label: "Manual",
		status: "Waiting for approval",
	},
	automate: {
		color: "#2f7767",
		icon: "sparkles",
		label: "Automate",
		status: "Working automatically",
	},
	plan: {
		color: "#4c6f9f",
		icon: "lightbulb",
		label: "Plan",
		status: "Planning changes",
	},
};

interface AgentModeControlProps {
	readonly disabled?: boolean;
	readonly mode: DesktopAgentMode;
	readonly onSelect: (mode: DesktopAgentMode) => void;
}

export function AgentModeControl({ disabled = false, mode, onSelect }: AgentModeControlProps) {
	const icons = useIcons();
	const [open, setOpen] = useState(false);
	const meta = agentModeMeta[mode];
	const Icon = icons[meta.icon];
	const ChevronDownIcon = icons["chevron-down"];

	return (
		<DropdownMenu open={open} onOpenChange={setOpen} disabled={disabled}>
			<DropdownTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="sm"
						active={open}
						disabled={disabled}
						aria-label={`Agent mode: ${meta.label}`}
						className="px-2.5 text-[13px]"
						style={{ color: meta.color, backgroundColor: `${meta.color}14` }}
					>
						<span className="inline-flex items-center gap-1.5">
							<Icon size={14} strokeWidth={1.7} />
							<span className="font-medium">{meta.label}</span>
							<ChevronDownIcon
								size={11}
								className={cn("opacity-55 transition-transform duration-150", { "rotate-180": open })}
							/>
						</span>
					</Button>
				}
			/>
			<DropdownContent checkedIndex={agentModes.indexOf(mode)} sideOffset={6} className="w-56">
				{agentModes.map((candidate, index) => {
					const option = agentModeMeta[candidate];
					return (
						<MenuItem
							key={candidate}
							index={index}
							icon={icons[option.icon]}
							label={option.label}
							description={modeDescription(candidate)}
							checked={candidate === mode}
							onSelect={() => onSelect(candidate)}
						/>
					);
				})}
			</DropdownContent>
		</DropdownMenu>
	);
}

interface ComposerDitherBannerProps {
	readonly mode: DesktopAgentMode;
	readonly streaming: boolean;
	readonly workspaceLabel?: string;
}

// 8×8 ordered (Bayer) matrix. Per-cell threshold turns a smooth intensity
// field into crisp pixels that dissolve at the edges — the signature look.
const BAYER_8 = [
	0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30,
	54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23,
	61, 29, 53, 21,
];

const CELL = 4;

function hexToRgb(hex: string): readonly [number, number, number] {
	const value = Number.parseInt(hex.replace("#", ""), 16);
	return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function ComposerDitherBanner({ mode, streaming, workspaceLabel }: ComposerDitherBannerProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const reducedMotion = useReducedMotion() ?? false;
	const meta = agentModeMeta[mode];
	const text = streaming ? `Working in ${workspaceLabel ?? "workspace"}` : meta.status;

	// Live-updated state read by the animation loop, so prop changes never
	// tear down and restart the canvas. `pointer` follows the cursor to light
	// up the dither locally; power/x/y are eased inside the loop.
	const stateRef = useRef({
		rgb: hexToRgb(meta.color),
		streaming,
		bloomAt: performance.now(),
		pointer: { x: 0, y: 0, targetX: 0, targetY: 0, power: 0, targetPower: 0 },
	});
	stateRef.current.rgb = hexToRgb(meta.color);
	stateRef.current.streaming = streaming;

	// Re-bloom the dither whenever the mode changes, without an extra effect
	// (a render-time ref compare avoids an unnecessary effect dependency).
	const previousColorRef = useRef(meta.color);
	if (previousColorRef.current !== meta.color) {
		previousColorRef.current = meta.color;
		stateRef.current.bloomAt = performance.now();
	}

	useEffect(() => {
		const canvas = canvasRef.current;
		const context = canvas?.getContext("2d");
		if (!canvas || !context) return;
		let frame: number | undefined;
		let width = 0;
		let height = 0;

		const paint = (now: number) => {
			if (!width || !height) return;
			const { rgb, streaming: live, bloomAt, pointer } = stateRef.current;
			const [r, g, b] = rgb;
			context.clearRect(0, 0, width, height);

			const idle = live ? 0.72 : 0.6;
			const breathe = reducedMotion ? 0 : Math.sin(now / 1500) * (live ? 0.06 : 0.035);
			const bloom = reducedMotion ? 1 : Math.min(1, (now - bloomAt) / 780);
			const ease = 1 - (1 - bloom) ** 3;
			const radiusScale = 0.52 + 0.48 * ease;
			const energy = idle + breathe + (1 - bloom) ** 2 * 0.5;

			// Ease the pointer spotlight toward its target every frame.
			pointer.power += (pointer.targetPower - pointer.power) * 0.16;
			pointer.x += (pointer.targetX - pointer.x) * 0.28;
			pointer.y += (pointer.targetY - pointer.y) * 0.28;
			const spotlight = pointer.power;
			const spotRadius = 72;

			// Anchor the dense core behind the mode icon/label on the left,
			// stretched horizontally so it dissolves rightward.
			const originX = 30;
			const originY = height / 2;
			const radiusX = 236 * radiusScale;
			const radiusY = height * 0.92 * radiusScale;

			for (let y = CELL / 2; y < height; y += CELL) {
				const dy = (y - originY) / radiusY;
				for (let x = CELL / 2; x < width; x += CELL) {
					const dx = (x - originX) / radiusX;
					const ambient = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy)) * energy;
					let spot = 0;
					if (spotlight > 0.01) {
						const near = 1 - Math.hypot(x - pointer.x, y - pointer.y) / spotRadius;
						if (near > 0) spot = near * near * spotlight;
					}
					const intensity = ambient + spot;
					if (intensity <= 0) continue;
					const threshold = (BAYER_8[(Math.floor(y / CELL) % 8) * 8 + (Math.floor(x / CELL) % 8)]! + 0.5) / 64;
					if (intensity <= threshold) continue;
					context.globalAlpha = Math.min(0.5, 0.13 + intensity * 0.26);
					context.fillStyle = `rgb(${r} ${g} ${b})`;
					context.fillRect(x - CELL / 2, y - CELL / 2, CELL - 1.5, CELL - 1.5);
				}
			}
			context.globalAlpha = 1;
		};

		const loop = (now: number) => {
			paint(now);
			frame = requestAnimationFrame(loop);
		};

		const resizeObserver = new ResizeObserver(() => {
			const bounds = canvas.getBoundingClientRect();
			const pixelRatio = window.devicePixelRatio || 1;
			width = Math.max(1, Math.floor(bounds.width));
			height = Math.max(1, Math.floor(bounds.height));
			canvas.width = Math.floor(width * pixelRatio);
			canvas.height = Math.floor(height * pixelRatio);
			context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
			if (reducedMotion) paint(performance.now());
		});
		resizeObserver.observe(canvas);

		if (!reducedMotion) frame = requestAnimationFrame(loop);
		return () => {
			resizeObserver.disconnect();
			if (frame !== undefined) cancelAnimationFrame(frame);
		};
	}, [reducedMotion]);

	const trackPointer = (event: PointerEvent<HTMLDivElement>) => {
		if (reducedMotion) return;
		const bounds = event.currentTarget.getBoundingClientRect();
		const pointer = stateRef.current.pointer;
		pointer.targetX = event.clientX - bounds.left;
		pointer.targetY = event.clientY - bounds.top;
		pointer.targetPower = 1;
	};
	const releasePointer = () => {
		stateRef.current.pointer.targetPower = 0;
	};

	const Icon = useIcons()[meta.icon];
	return (
		<div
			className="relative flex h-8 cursor-default select-none items-center gap-2 overflow-hidden px-4 text-[12.5px] font-medium"
			style={{ color: meta.color }}
			onPointerMove={trackPointer}
			onPointerEnter={trackPointer}
			onPointerLeave={releasePointer}
		>
			<canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
			<Icon size={15} strokeWidth={1.65} className="relative shrink-0" />
			<span className="relative">{text}</span>
		</div>
	);
}

function modeDescription(mode: DesktopAgentMode): string {
	switch (mode) {
		case "manual":
			return "Ask before changes";
		case "automate":
			return "Approve work automatically";
		case "plan":
			return "Read and plan without changes";
	}
}
