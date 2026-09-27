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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog";
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

/**
 * Chooses how tool calls get permission. Interaction mode (Plan) lives in the `+` menu, not here.
 * Auto hands approvals to a reviewer model, so it is confirmed on entry and stays accented while active.
 */
export function PermissionModeControl({ disabled = false, value, onChange }: PermissionModeControlProps) {
	const intl = useIntl();
	const icons = useIcons();
	const reducedMotion = useReducedMotion() ?? false;
	const [open, setOpen] = useState(false);
	const [confirmingAuto, setConfirmingAuto] = useState(false);
	const meta = permissionModeMeta[value];
	const modeLabel = intl.formatMessage(meta.label);
	const Icon = icons[meta.icon];
	const ChevronDownIcon = icons["chevron-down"];
	const AutoIcon = icons[permissionModeMeta.auto.icon];

	const select = (mode: DesktopPermissionMode) => {
		if (mode === "auto" && value !== "auto") setConfirmingAuto(true);
		else onChange(mode);
	};

	return (
		<>
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
							className={cn(
								"h-8 text-[14px] text-foreground/80",
								value === "auto" && "text-caution hover:text-caution",
							)}
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
								variant={mode === "auto" ? "accent" : "default"}
								onSelect={() => select(mode)}
							/>
						);
					})}
				</DropdownContent>
			</DropdownMenu>
			<Dialog open={confirmingAuto} onOpenChange={setConfirmingAuto}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<AutoIcon size={18} strokeWidth={1.75} className="shrink-0 text-caution" />
							{intl.formatMessage(desktopMessages.permissionModeAutoConfirmTitle)}
						</DialogTitle>
						<DialogDescription>
							{intl.formatMessage(desktopMessages.permissionModeAutoConfirmReviewer)}
						</DialogDescription>
					</DialogHeader>
					<p className="text-[13px] leading-relaxed text-muted-foreground">
						{intl.formatMessage(desktopMessages.permissionModeAutoConfirmRisk)}
					</p>
					<DialogFooter>
						<Button type="button" variant="ghost" onClick={() => setConfirmingAuto(false)}>
							{intl.formatMessage(desktopMessages.commonCancel)}
						</Button>
						<Button
							type="button"
							onClick={() => {
								setConfirmingAuto(false);
								onChange("auto");
							}}
						>
							{intl.formatMessage(desktopMessages.permissionModeAutoConfirmAction)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
