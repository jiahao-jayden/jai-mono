import { useState } from "react";
import { useIcons } from "@/lib/icon-context";
import { Button } from "../../ui/button";
import { DropdownContent, DropdownMenu, DropdownTrigger } from "../../ui/dropdown";
import { MenuItem } from "../../ui/menu-item";

interface MessageAttachmentPickerProps {
	readonly disabled: boolean;
	onOpen(): void;
}

export function MessageAttachmentPicker({ disabled, onOpen }: MessageAttachmentPickerProps) {
	const icons = useIcons();
	const PlusIcon = icons.plus;
	const [open, setOpen] = useState(false);
	const triggerLabel = "Add files or photos";

	return (
		<DropdownMenu open={open} onOpenChange={setOpen} disabled={disabled}>
			<DropdownTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						disabled={disabled}
						active={open}
						aria-label={triggerLabel}
						title={triggerLabel}
					>
						<PlusIcon size={14} strokeWidth={1.5} />
					</Button>
				}
			/>
			<DropdownContent className="w-60" sideOffset={6}>
				<MenuItem
					index={0}
					icon={icons.image}
					label="Add files or photos"
					description="Files and photos up to 20 MB"
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
