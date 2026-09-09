import { useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import { Button } from "../../ui/button";
import { DropdownContent, DropdownMenu, DropdownTrigger } from "../../ui/dropdown";
import { MenuItem } from "../../ui/menu-item";

interface MessageAttachmentPickerProps {
	readonly disabled: boolean;
	onOpen(): void;
}

export function MessageAttachmentPicker({ disabled, onOpen }: MessageAttachmentPickerProps) {
	const intl = useIntl();
	const icons = useIcons();
	const PlusIcon = icons.plus;
	const [open, setOpen] = useState(false);
	const triggerLabel = intl.formatMessage(desktopMessages.attachmentsAdd);

	return (
		<DropdownMenu open={open} onOpenChange={setOpen} disabled={disabled}>
			<DropdownTrigger
				render={
					<Button
						type="button"
						variant="secondary"
						size="icon-sm"
						disabled={disabled}
						active={open}
						aria-label={triggerLabel}
						title={triggerLabel}
						className="rounded-full no-squircle"
					>
						<PlusIcon size={16} strokeWidth={1.5} />
					</Button>
				}
			/>
			<DropdownContent className="w-60" sideOffset={6}>
				<MenuItem
					index={0}
					icon={icons.image}
					label={triggerLabel}
					disabled={disabled}
					onSelect={() => {
						onOpen();
						setOpen(false);
					}}
				/>
			</DropdownContent>
		</DropdownMenu>
	);
}
