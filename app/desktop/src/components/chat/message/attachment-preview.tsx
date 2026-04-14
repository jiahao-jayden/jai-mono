import { FileTextIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
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

function useTextPreview(attachment: ChatAttachment): string | null {
	const [preview, setPreview] = useState<string | null>(null);
	const url = attachment.previewUrl ?? attachment.dataUrl;
	const isPastedText = attachment.mimeType === "text/plain" && attachment.filename === "pasted-content.txt" && !!url;

	useEffect(() => {
		if (!isPastedText || !url) return;

		let cancelled = false;

		if (url.startsWith("data:")) {
			const commaIdx = url.indexOf(",");
			if (commaIdx !== -1) {
				try {
					setPreview(atob(url.slice(commaIdx + 1)).slice(0, 100));
				} catch {
					setPreview(decodeURIComponent(url.slice(commaIdx + 1)).slice(0, 100));
				}
			}
			return;
		}

		fetch(url)
			.then((r) => r.text())
			.then((text) => {
				if (!cancelled) setPreview(text.slice(0, 100));
			})
			.catch(() => {});

		return () => {
			cancelled = true;
		};
	}, [isPastedText, url]);

	return preview;
}

function PastedTextCard({ attachment, onRemove, preview }: AttachmentCardProps & { preview: string }) {
	const charCount = attachment.size || preview.length;
	return (
		<div className="group relative flex h-24 w-56 shrink-0 flex-col gap-1.5 rounded-lg border border-zinc-200/80 bg-zinc-50 p-2.5 dark:border-zinc-700/60 dark:bg-zinc-800/50">
			<div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
				<FileTextIcon className="size-3.5 shrink-0" />
				<span className="text-[11px] font-medium">Pasted text{charCount > 0 ? ` · ${charCount} chars` : ""}</span>
			</div>
			<p className="line-clamp-2 flex-1 text-[12px] leading-relaxed text-foreground/70">{preview}</p>
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

function AttachmentItem({ attachment, onRemove }: AttachmentCardProps) {
	const textPreview = useTextPreview(attachment);
	const isImage = attachment.mimeType.startsWith("image/");
	const hasSrc = attachment.previewUrl || attachment.dataUrl;

	if (isImage && hasSrc) {
		return <ImageCard attachment={attachment} onRemove={onRemove} />;
	}
	if (textPreview) {
		return <PastedTextCard attachment={attachment} onRemove={onRemove} preview={textPreview} />;
	}
	return <FileCard attachment={attachment} onRemove={onRemove} />;
}

export function AttachmentList({ attachments, onRemove }: AttachmentListProps) {
	if (attachments.length === 0) return null;

	return (
		<div className="flex items-start gap-2 overflow-x-auto scrollbar-hidden pt-1.5 pr-2">
			{attachments.map((att) => {
				const remove = onRemove ? () => onRemove(att.id) : undefined;
				return <AttachmentItem key={att.id} attachment={att} onRemove={remove} />;
			})}
		</div>
	);
}
