import { XIcon } from "lucide-react";
import type { ChatAttachment } from "@/types/chat";

function getExt(filename: string): string {
	const dot = filename.lastIndexOf(".");
	if (dot === -1) return "";
	return filename.slice(dot + 1).toUpperCase();
}

function RemoveButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="absolute -top-1.5 -right-1.5 flex size-4.5 items-center justify-center rounded-full bg-zinc-800 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900 opacity-0 transition-opacity group-hover:opacity-100"
		>
			<XIcon className="size-2.5" strokeWidth={2.5} />
		</button>
	);
}

interface AttachmentCardProps {
	attachment: ChatAttachment;
	onRemove?: () => void;
}

function ImageCard({ attachment, onRemove }: AttachmentCardProps) {
	const src = attachment.previewUrl ?? attachment.dataUrl;
	return (
		<div className="group relative shrink-0">
			<img
				src={src}
				alt={attachment.filename}
				className="h-24 rounded-lg object-cover border border-zinc-200/80 dark:border-zinc-700/60"
			/>
			{onRemove && <RemoveButton onClick={onRemove} />}
		</div>
	);
}

function FileCard({ attachment, onRemove }: AttachmentCardProps) {
	const ext = getExt(attachment.filename);
	return (
		<div className="group relative flex h-24 w-36 shrink-0 flex-col justify-between rounded-lg border border-zinc-200/80 bg-zinc-50 p-2.5 dark:border-zinc-700/60 dark:bg-zinc-800/50">
			<p className="line-clamp-2 text-[13px] font-medium leading-snug text-foreground/90">{attachment.filename}</p>
			{ext && (
				<span className="self-start rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-zinc-500 bg-zinc-200/70 dark:text-zinc-400 dark:bg-zinc-700/60">
					{ext}
				</span>
			)}
			{onRemove && <RemoveButton onClick={onRemove} />}
		</div>
	);
}

interface AttachmentListProps {
	attachments: ChatAttachment[];
	onRemove?: (id: string) => void;
}

export function AttachmentList({ attachments, onRemove }: AttachmentListProps) {
	if (attachments.length === 0) return null;

	return (
		<div className="flex items-start gap-2 overflow-x-auto scrollbar-hidden pt-1.5 pr-2">
			{attachments.map((att) => {
				const isImage = att.mimeType.startsWith("image/");
				const hasSrc = att.previewUrl || att.dataUrl;
				const remove = onRemove ? () => onRemove(att.id) : undefined;

				return isImage && hasSrc ? (
					<ImageCard key={att.id} attachment={att} onRemove={remove} />
				) : (
					<FileCard key={att.id} attachment={att} onRemove={remove} />
				);
			})}
		</div>
	);
}
