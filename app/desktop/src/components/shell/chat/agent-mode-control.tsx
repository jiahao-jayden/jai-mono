"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import type { IconName } from "@/lib/icon-context";
import { useIcons } from "@/lib/icon-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import type { DesktopAgentMode } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { DropdownContent, DropdownMenu, DropdownTrigger } from "../../ui/dropdown";
import { MenuItem } from "../../ui/menu-item";

interface AgentModeMeta {
	readonly iconClassName: string;
	readonly icon: IconName;
	readonly message: (typeof desktopMessages)[keyof typeof desktopMessages];
	readonly surfaceClassName: string;
}

const agentModes: readonly DesktopAgentMode[] = ["manual", "automate", "plan"];

const agentModeMeta: Readonly<Record<DesktopAgentMode, AgentModeMeta>> = {
	manual: {
		iconClassName: "text-agent-mode-manual",
		icon: "shield",
		message: desktopMessages.modeManual,
		surfaceClassName: "bg-transparent",
	},
	automate: {
		iconClassName: "text-agent-mode-automate",
		icon: "rocket",
		message: desktopMessages.modeAutomate,
		surfaceClassName: "bg-agent-mode-automate-surface",
	},
	plan: {
		iconClassName: "text-agent-mode-plan",
		icon: "brain",
		message: desktopMessages.modePlan,
		surfaceClassName: "bg-agent-mode-plan-surface",
	},
};

interface AgentModeControlProps {
	readonly disabled?: boolean;
	readonly mode: DesktopAgentMode;
	readonly onSelect: (mode: DesktopAgentMode) => void;
}

export function AgentModeControl({ disabled = false, mode, onSelect }: AgentModeControlProps) {
	const intl = useIntl();
	const icons = useIcons();
	const reducedMotion = useReducedMotion() ?? false;
	const [open, setOpen] = useState(false);
	const meta = agentModeMeta[mode];
	const modeLabel = intl.formatMessage(meta.message);
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
						aria-label={intl.formatMessage(desktopMessages.modeAria, { mode: modeLabel })}
						className={cn("px-2.5 text-[13px] text-foreground", meta.surfaceClassName)}
						labelClassName="flex items-center [text-box:normal]"
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
									<Icon size={14} strokeWidth={1.7} className={meta.iconClassName} />
									<span className="font-medium">{modeLabel}</span>
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
			<DropdownContent checkedIndex={agentModes.indexOf(mode)} sideOffset={6} className="w-44">
				{agentModes.map((candidate, index) => {
					const option = agentModeMeta[candidate];
					const optionLabel = intl.formatMessage(option.message);
					return (
						<MenuItem
							key={candidate}
							index={index}
							icon={icons[option.icon]}
							label={optionLabel}
							className="h-8 px-2"
							checked={candidate === mode}
							onSelect={() => onSelect(candidate)}
						/>
					);
				})}
			</DropdownContent>
		</DropdownMenu>
	);
}
