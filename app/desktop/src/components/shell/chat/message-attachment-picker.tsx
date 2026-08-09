import { useState } from "react";
import { desktop } from "@/lib/desktop";
import { useIcons } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { DesktopMessageAttachment } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { DropdownContent, DropdownMenu, DropdownTrigger } from "../../ui/dropdown";
import { MenuItem } from "../../ui/menu-item";

const MAX_MESSAGE_ATTACHMENT_BYTES = 20 * 1024 * 1024;

interface MessageAttachmentPickerProps {
	readonly attachments: readonly DesktopMessageAttachment[];
	readonly disabled: boolean;
	onAdd(attachments: readonly DesktopMessageAttachment[]): void;
	onError(message: string): void;
}

interface MessageAttachmentPreviewProps {
	readonly attachments: readonly DesktopMessageAttachment[];
	onRemove(attachment: DesktopMessageAttachment): void;
}

export function MessageAttachmentPicker({ attachments, disabled, onAdd, onError }: MessageAttachmentPickerProps) {
	const icons = useIcons();
	const PlusIcon = icons.plus;
	const [open, setOpen] = useState(false);
	const [selecting, setSelecting] = useState(false);
	const addDisabled = disabled || selecting;

	const selectAttachments = async () => {
		setSelecting(true);
		try {
			const picked = await desktop.attachment.pick();
			const existingIds = new Set(attachments.map((attachment) => attachment.id));
			const next: DesktopMessageAttachment[] = [];
			const rejected: string[] = [];
			let total = attachments.reduce((sum, attachment) => sum + attachment.size, 0);
			for (const attachment of picked) {
				if (existingIds.has(attachment.id)) continue;
				if (total + attachment.size > MAX_MESSAGE_ATTACHMENT_BYTES) {
					rejected.push(attachment.id);
					continue;
				}
				total += attachment.size;
				next.push(attachment);
			}
			if (rejected.length > 0) {
				void desktop.attachment.release(rejected);
				onError("Attachments must be 20 MB or less in total.");
			}
			if (next.length > 0) onAdd(next);
		} catch (error) {
			const message =
				error instanceof Error && error.message
					? error.message
					: "Could not add those files. Check the file and try again.";
			onError(message);
		} finally {
			setSelecting(false);
			setOpen(false);
		}
	};

	const addLabel = selecting ? "Selecting files…" : "Add files or photos";
	const triggerLabel = selecting ? "Selecting files" : "Add files or photos";

	return (
		<DropdownMenu open={open} onOpenChange={setOpen} disabled={addDisabled}>
			<DropdownTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						disabled={addDisabled}
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
					label={addLabel}
					description="Files and photos up to 20 MB"
					disabled={addDisabled}
					onSelect={() => void selectAttachments()}
				/>
			</DropdownContent>
		</DropdownMenu>
	);
}

export function MessageAttachmentPreview({ attachments, onRemove }: MessageAttachmentPreviewProps) {
	return (
		<div className="flex flex-wrap gap-1.5">
			{attachments.map((attachment) => (
				<MessageAttachmentChip key={attachment.id} attachment={attachment} onRemove={onRemove} />
			))}
		</div>
	);
}

function MessageAttachmentChip({
	attachment,
	onRemove,
}: {
	readonly attachment: DesktopMessageAttachment;
	readonly onRemove: (attachment: DesktopMessageAttachment) => void;
}) {
	const icons = useIcons();
	const isImage = attachment.mimeType.startsWith("image/");
	const AttachmentIcon = isImage ? icons.image : icons["file-code"];
	const XIcon = icons.x;
	const removeLabel = `Remove ${attachment.filename}`;
	const sizeLabel = formatBytes(attachment.size);
	const iconClassName = cn(isImage ? "text-primary-2" : "text-muted-foreground");

	return (
		<div className="group flex min-w-0 max-w-72 items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-[12px] text-foreground shadow-surface-1">
			<AttachmentIcon size={14} strokeWidth={1.6} className={iconClassName} aria-hidden="true" />
			<span className="min-w-0 truncate" title={attachment.filename}>
				{attachment.filename}
			</span>
			<span className="shrink-0 text-muted-foreground">{sizeLabel}</span>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="-mr-1 size-5 shrink-0 opacity-60 group-hover:opacity-100"
				onClick={() => onRemove(attachment)}
				aria-label={removeLabel}
				title={removeLabel}
			>
				<XIcon size={12} strokeWidth={2} />
			</Button>
		</div>
	);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
