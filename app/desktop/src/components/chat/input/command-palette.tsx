import type { CommandListItem } from "@jayden/jai-gateway";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { useImperativeHandle, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type CommandPaletteHandle = {
	moveActive: (delta: number) => void;
	selectActive: () => boolean;
	hasMatches: () => boolean;
};

export type ParsedCommandQuery = {
	visible: boolean;
	query: string;
	tokenStart: number;
};

const HIDDEN: ParsedCommandQuery = { visible: false, query: "", tokenStart: 0 };

export function parseCommandQuery(value: string, cursorPos: number): ParsedCommandQuery {
	if (cursorPos <= 0 || cursorPos > value.length) {
		if (value.length === 0) return HIDDEN;
	}

	const pos = Math.min(cursorPos, value.length);
	const before = value.slice(0, pos);

	const slashIdx = before.lastIndexOf("/");
	if (slashIdx === -1) return HIDDEN;
	if (slashIdx > 0 && !/\s/.test(value[slashIdx - 1])) return HIDDEN;

	const token = before.slice(slashIdx + 1);
	if (/\s/.test(token)) return HIDDEN;

	return { visible: true, query: token, tokenStart: slashIdx };
}

function filterCommands(commands: CommandListItem[], query: string): CommandListItem[] {
	const q = query.trim().toLowerCase();
	if (!q) return [...commands].sort((a, b) => a.fullName.localeCompare(b.fullName));

	const scored = commands
		.map((cmd) => {
			const name = cmd.fullName.toLowerCase();
			const desc = (cmd.description ?? "").toLowerCase();

			let score = -1;
			if (name.startsWith(q)) score = 0;
			else if (name.includes(q)) score = 1;
			else if (desc.includes(q)) score = 2;

			return { cmd, score };
		})
		.filter((s) => s.score >= 0);

	scored.sort((a, b) => a.score - b.score || a.cmd.fullName.localeCompare(b.cmd.fullName));
	return scored.map((s) => s.cmd);
}

type CommandPaletteProps = {
	commands: CommandListItem[];
	query: string;
	visible: boolean;
	onSelect: (cmd: CommandListItem) => void;
	ref?: React.Ref<CommandPaletteHandle>;
};

export function CommandPalette({ commands, query, visible, onSelect, ref }: CommandPaletteProps) {
	const filtered = useMemo(() => filterCommands(commands, query), [commands, query]);
	const [activeIdx, setActiveIdx] = useState(0);
	const [prevQuery, setPrevQuery] = useState(query);
	const listRef = useRef<HTMLDivElement | null>(null);

	if (prevQuery !== query) {
		setPrevQuery(query);
		setActiveIdx(0);
	}

	useImperativeHandle(
		ref,
		() => ({
			moveActive(delta: number) {
				if (filtered.length === 0) return;
				setActiveIdx((idx) => {
					const next = (idx + delta + filtered.length) % filtered.length;
					queueMicrotask(() => {
						listRef.current
							?.querySelector<HTMLElement>(`[data-cmd-idx="${next}"]`)
							?.scrollIntoView({ block: "nearest" });
					});
					return next;
				});
			},
			selectActive() {
				const cmd = filtered[activeIdx];
				if (!cmd) return false;
				onSelect(cmd);
				return true;
			},
			hasMatches() {
				return filtered.length > 0;
			},
		}),
		[filtered, activeIdx, onSelect],
	);

	if (!visible || filtered.length === 0) return null;

	return (
		<TooltipPrimitive.Provider delayDuration={300} skipDelayDuration={100}>
			<div
				data-slot="command-palette"
				className={cn(
					"absolute bottom-full left-0 mb-2 z-30 w-72 origin-bottom-left",
					"rounded-lg bg-card text-foreground",
					"ring-1 ring-foreground/6",
					"shadow-[0_1px_1px_oklch(0_0_0/0.03),0_10px_22px_-14px_oklch(0_0_0/0.14)]",
					"overflow-hidden",
					"animate-in fade-in-0 zoom-in-[0.98] slide-in-from-bottom-1 duration-150",
				)}
			>
				<div ref={listRef} className="max-h-80 overflow-y-auto py-1 no-scrollbar">
					{filtered.map((cmd, idx) => {
						const isActive = idx === activeIdx;
						const hasDesc = Boolean(cmd.description);
						const btn = (
							<button
								type="button"
								data-cmd-idx={idx}
								data-active={isActive ? "true" : undefined}
								className={cn(
									"block w-full px-3 py-1.5 text-left",
									"transition-colors duration-100",
									isActive ? "bg-primary-2/8" : "hover:bg-foreground/2.5",
								)}
								onMouseEnter={() => setActiveIdx(idx)}
								onMouseDown={(e) => {
									e.preventDefault();
									onSelect(cmd);
								}}
							>
								<span className="flex items-baseline gap-2">
									<span
										className={cn(
											"min-w-0 flex-1 truncate text-sm",
											isActive ? "text-primary-2" : "text-primary-2/60",
										)}
									>
										{cmd.fullName}
									</span>
									{isActive && cmd.argumentHint ? (
										<span className="shrink-0 text-[11px] tracking-wide text-muted-foreground/60">
											{cmd.argumentHint}
										</span>
									) : null}
								</span>
							</button>
						);

						if (!hasDesc) return <div key={cmd.fullName}>{btn}</div>;

						return (
							<TooltipPrimitive.Root key={cmd.fullName}>
								<TooltipPrimitive.Trigger asChild>{btn}</TooltipPrimitive.Trigger>
								<TooltipPrimitive.Portal>
									<TooltipPrimitive.Content
										side="right"
										align="start"
										sideOffset={12}
										collisionPadding={16}
										className={cn(
											"z-50 max-w-xs whitespace-normal rounded-md",
											"bg-card text-foreground/85",
											"ring-1 ring-foreground/6",
											"shadow-[0_1px_1px_oklch(0_0_0/0.03),0_10px_22px_-14px_oklch(0_0_0/0.14)]",
											"px-3 py-2 text-xs leading-relaxed",
											"animate-in fade-in-0 zoom-in-95 duration-100",
										)}
									>
										{cmd.description}
									</TooltipPrimitive.Content>
								</TooltipPrimitive.Portal>
							</TooltipPrimitive.Root>
						);
					})}
				</div>
			</div>
		</TooltipPrimitive.Provider>
	);
}
