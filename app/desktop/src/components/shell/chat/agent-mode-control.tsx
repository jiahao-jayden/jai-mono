"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import type { IconName } from "@/lib/icon-context";
import { useIcons } from "@/lib/icon-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import type { DesktopAgentMode } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { DropdownContent, DropdownMenu, DropdownTrigger } from "../../ui/dropdown";
import { MenuItem } from "../../ui/menu-item";

interface AgentModeMeta {
	readonly color: string;
	readonly icon: IconName;
	readonly label: string;
}

const agentModes: readonly DesktopAgentMode[] = ["manual", "automate", "plan"];

const agentModeMeta: Readonly<Record<DesktopAgentMode, AgentModeMeta>> = {
	manual: {
		color: "#8a6b3f",
		icon: "shield",
		label: "Manual",
	},
	automate: {
		color: "#2f7767",
		icon: "rocket",
		label: "Automate",
	},
	plan: {
		color: "#4c6f9f",
		icon: "brain",
		label: "Plan",
	},
};

interface AgentModeControlProps {
	readonly disabled?: boolean;
	readonly mode: DesktopAgentMode;
	readonly onSelect: (mode: DesktopAgentMode) => void;
}

export function AgentModeControl({ disabled = false, mode, onSelect }: AgentModeControlProps) {
	const icons = useIcons();
	const reducedMotion = useReducedMotion() ?? false;
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
						labelClassName="flex items-center [text-box:normal]"
						style={{ color: meta.color, backgroundColor: `${meta.color}14` }}
					>
						<span className="inline-flex items-center gap-1.5">
							{/* Quiet Swap: the icon+label cross-swap in place on mode change
							    (state indication); the tinted background/colour transitions via
							    the Button's own transition-colors. The chevron stays put. */}
							<AnimatePresence mode="popLayout" initial={false}>
								<motion.span
									key={mode}
									className="inline-flex items-center gap-1.5"
									initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
									animate={{ opacity: 1, y: 0 }}
									exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
									transition={spring.moderate}
								>
									<Icon size={14} strokeWidth={1.7} />
									<span className="font-medium">{meta.label}</span>
								</motion.span>
							</AnimatePresence>
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
							checked={candidate === mode}
							onSelect={() => onSelect(candidate)}
						/>
					);
				})}
			</DropdownContent>
		</DropdownMenu>
	);
}
