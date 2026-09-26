import { useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import type { IconName } from "@/lib/icon-context";
import { useIcons } from "@/lib/icon-context";
import { type DesktopInteractionMode, desktopInteractionModes } from "../../../../shared/session-controls";
import { Button } from "../../ui/button";
import { DropdownContent, DropdownLabel, DropdownMenu, DropdownSeparator, DropdownTrigger } from "../../ui/dropdown";
import { MenuItem } from "../../ui/menu-item";

type Message = (typeof desktopMessages)[keyof typeof desktopMessages];

const interactionModeMeta: Readonly<
	Record<DesktopInteractionMode, { readonly icon: IconName; readonly label: Message; readonly description: Message }>
> = {
	normal: {
		icon: "message-circle",
		label: desktopMessages.interactionModeNormal,
		description: desktopMessages.interactionModeNormalDescription,
	},
	plan: {
		icon: "check-list",
		label: desktopMessages.interactionModePlan,
		description: desktopMessages.interactionModePlanDescription,
	},
};

/** Interaction mode items follow the attachment item, so their menu indexes start after it. */
const INTERACTION_MODE_INDEX_OFFSET = 1;

interface ComposerAddMenuProps {
	readonly disabled: boolean;
	readonly attachmentsDisabled: boolean;
	readonly interactionMode: DesktopInteractionMode;
	onOpenFiles(): void;
	onInteractionModeChange(mode: DesktopInteractionMode): void;
}

/** The composer `+` menu: attachments plus the Session interaction mode. Never touches the permission mode. */
export function ComposerAddMenu({
	disabled,
	attachmentsDisabled,
	interactionMode,
	onOpenFiles,
	onInteractionModeChange,
}: ComposerAddMenuProps) {
	const intl = useIntl();
	const icons = useIcons();
	const PlusIcon = icons.plus;
	const [open, setOpen] = useState(false);
	const triggerLabel = intl.formatMessage(desktopMessages.composerAddMenu);

	return (
		<DropdownMenu open={open} onOpenChange={setOpen} disabled={disabled}>
			<DropdownTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon"
						disabled={disabled}
						active={open}
						aria-label={triggerLabel}
						title={triggerLabel}
						className="rounded-full no-squircle text-foreground [&_svg]:size-5 [&_svg]:stroke-[1.75]"
					>
						<PlusIcon size={20} strokeWidth={1.75} />
					</Button>
				}
			/>
			<DropdownContent
				className="w-64"
				side="top"
				sideOffset={6}
				checkedIndex={INTERACTION_MODE_INDEX_OFFSET + desktopInteractionModes.indexOf(interactionMode)}
			>
				<MenuItem
					index={0}
					icon={icons.image}
					label={intl.formatMessage(desktopMessages.attachmentsAdd)}
					disabled={attachmentsDisabled}
					onSelect={() => {
						onOpenFiles();
						setOpen(false);
					}}
				/>
				<DropdownSeparator />
				<DropdownLabel>{intl.formatMessage(desktopMessages.interactionModeLabel)}</DropdownLabel>
				{desktopInteractionModes.map((mode, position) => {
					const option = interactionModeMeta[mode];
					return (
						<MenuItem
							key={mode}
							index={INTERACTION_MODE_INDEX_OFFSET + position}
							icon={icons[option.icon]}
							label={intl.formatMessage(option.label)}
							description={intl.formatMessage(option.description)}
							checked={mode === interactionMode}
							onSelect={() => onInteractionModeChange(mode)}
						/>
					);
				})}
			</DropdownContent>
		</DropdownMenu>
	);
}

interface PlanModeChipProps {
	readonly disabled: boolean;
	onTurnOff(): void;
}

/** Keeps an active Plan mode visible outside the `+` menu and offers a one-click exit. */
export function PlanModeChip({ disabled, onTurnOff }: PlanModeChipProps) {
	const intl = useIntl();
	const icons = useIcons();
	const PlanIcon = icons["check-list"];
	const CloseIcon = icons.x;
	const label = intl.formatMessage(desktopMessages.interactionModePlanOff);

	return (
		<Button
			type="button"
			variant="ghost"
			size="chip"
			active
			aria-pressed
			disabled={disabled}
			aria-label={label}
			title={label}
			onClick={onTurnOff}
			className="h-8 text-[14px] text-foreground/80"
			labelClassName="flex items-center [text-box:normal]"
		>
			<span className="inline-flex items-center gap-1.5">
				<PlanIcon size={16} strokeWidth={1.75} />
				<span>{intl.formatMessage(desktopMessages.interactionModePlan)}</span>
				<CloseIcon size={12} className="opacity-50" />
			</span>
		</Button>
	);
}
