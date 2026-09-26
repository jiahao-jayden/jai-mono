import { cn } from "cn";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import type { IconName } from "@/lib/icon-context";
import { useIcons } from "@/lib/icon-context";
import { spring } from "@/lib/springs";
import { type DesktopPermissionMode, desktopPermissionModes } from "../../../../shared/session-controls";
import { Button } from "../../ui/button";
import { DropdownContent, DropdownMenu, DropdownTrigger } from "../../ui/dropdown";
import { MenuItem } from "../../ui/menu-item";

type Message = (typeof desktopMessages)[keyof typeof desktopMessages];

const permissionModeMeta: Readonly<
	Record<DesktopPermissionMode, { readonly icon: IconName; readonly label: Message; readonly description: Message }>
> = {
	ask: {
		icon: "permission-ask",
		label: desktopMessages.permissionModeAsk,
		description: desktopMessages.permissionModeAskDescription,
	},
	allow: {
		icon: "unlock",
		label: desktopMessages.permissionModeAllow,
		description: desktopMessages.permissionModeAllowDescription,
	},
	auto: {
		icon: "ai-security",
		label: desktopMessages.permissionModeAuto,
		description: desktopMessages.permissionModeAutoDescription,
	},
};

interface PermissionModeControlProps {
	readonly disabled?: boolean;
	readonly value: DesktopPermissionMode;
	readonly onChange: (mode: DesktopPermissionMode) => void;
}

/** Chooses how tool calls get permission. Interaction mode (Plan) lives in the `+` menu, not here. */
export function PermissionModeControl({ disabled = false, value, onChange }: PermissionModeControlProps) {
	const intl = useIntl();
	const icons = useIcons();
	const reducedMotion = useReducedMotion() ?? false;
	const [open, setOpen] = useState(false);
	const meta = permissionModeMeta[value];
	const modeLabel = intl.formatMessage(meta.label);
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
						aria-label={intl.formatMessage(desktopMessages.permissionModeAria, { mode: modeLabel })}
						title={intl.formatMessage(meta.description)}
						className="h-8 text-[14px] text-foreground/80"
						labelClassName="flex items-center [text-box:normal]"
					>
						<span className="inline-flex items-center gap-1">
							<AnimatePresence mode="popLayout" initial={false}>
								<motion.span
									key={value}
									className="inline-flex items-center gap-1.5"
									initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
									animate={{ opacity: 1, y: 0 }}
									exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
									transition={spring.moderate}
								>
									<Icon size={16} strokeWidth={1.75} />
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
			<DropdownContent
				checkedIndex={desktopPermissionModes.indexOf(value)}
				side="top"
				sideOffset={6}
				size="sm"
				className="w-72"
			>
				{desktopPermissionModes.map((mode, index) => {
					const option = permissionModeMeta[mode];
					return (
						<MenuItem
							key={mode}
							index={index}
							icon={icons[option.icon]}
							label={intl.formatMessage(option.label)}
							description={intl.formatMessage(option.description)}
							checked={mode === value}
							onSelect={() => onChange(mode)}
						/>
					);
				})}
			</DropdownContent>
		</DropdownMenu>
	);
}
