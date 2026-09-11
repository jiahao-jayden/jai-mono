"use client";

import { cn } from "cn";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import type { IconName } from "@/lib/icon-context";
import { useIcons } from "@/lib/icon-context";
import { spring } from "@/lib/springs";
import type { DesktopAgentMode } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { DropdownContent, DropdownMenu, DropdownTrigger } from "../../ui/dropdown";
import { MenuItem } from "../../ui/menu-item";

interface AgentModeMeta {
	readonly icon: IconName;
	readonly message: (typeof desktopMessages)[keyof typeof desktopMessages];
}

const agentModes: readonly DesktopAgentMode[] = ["manual", "automate", "plan"];

const agentModeMeta: Readonly<Record<DesktopAgentMode, AgentModeMeta>> = {
	manual: {
		icon: "shield",
		message: desktopMessages.modeManual,
	},
	automate: {
		icon: "rocket",
		message: desktopMessages.modeAutomate,
	},
	plan: {
		icon: "brain",
		message: desktopMessages.modePlan,
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
						size="chip"
						active={open}
						disabled={disabled}
						aria-label={intl.formatMessage(desktopMessages.modeAria, { mode: modeLabel })}
						labelClassName="flex items-center [text-box:normal]"
					>
						<span className="inline-flex items-center gap-1">
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
									<Icon size={14} strokeWidth={1.5} />
									<span>{modeLabel}</span>
								</motion.span>
							</AnimatePresence>
							<ChevronDownIcon
								size={14}
								className={cn("opacity-50 transition-transform duration-150", { "rotate-180": open })}
							/>
						</span>
					</Button>
				}
			/>
			<DropdownContent checkedIndex={agentModes.indexOf(mode)} sideOffset={6} size="sm" className="w-44">
				{agentModes.map((candidate, index) => {
					const option = agentModeMeta[candidate];
					const optionLabel = intl.formatMessage(option.message);
					return (
						<MenuItem
							key={candidate}
							index={index}
							icon={icons[option.icon]}
							label={optionLabel}
							checked={candidate === mode}
							onSelect={() => onSelect(candidate)}
						/>
					);
				})}
			</DropdownContent>
		</DropdownMenu>
	);
}
