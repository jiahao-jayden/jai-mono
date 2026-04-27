import { FileTextIcon, XIcon } from "lucide-react";
import type { PastedText } from "./paste-attachment";

interface PastedTextChipProps {
	pasted: PastedText;
	onRemove: () => void;
}

function PastedTextChip({ pasted, onRemove }: PastedTextChipProps) {
	const preview = pasted.text.slice(0, 200).replace(/\s+/g, " ").trim();
	return (
		<div className="group relative flex h-24 w-56 shrink-0 flex-col gap-1.5 rounded-lg border border-zinc-200/80 bg-zinc-50 p-2.5 dark:border-zinc-700/60 dark:bg-zinc-800/50">
			<div className="flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
				<FileTextIcon className="size-3.5 shrink-0" />
				<span className="text-[11px] font-medium">Pasted text · {pasted.text.length} chars</span>
			</div>
			<p className="line-clamp-2 flex-1 text-[12px] leading-relaxed text-foreground/70">{preview}</p>
			<button
				type="button"
				onClick={onRemove}
				className="absolute -top-1.5 -right-1.5 flex size-4.5 items-center justify-center rounded-full bg-zinc-800 text-zinc-100 dark:bg-zinc-200 dark:text-zinc-900 opacity-0 transition-opacity group-hover:opacity-100"
			>
				<XIcon className="size-2.5" strokeWidth={2.5} />
			</button>
		</div>
	);
}

interface PastedTextChipListProps {
	pastedTexts: PastedText[];
	onRemove: (id: string) => void;
}

export function PastedTextChipList({ pastedTexts, onRemove }: PastedTextChipListProps) {
	if (pastedTexts.length === 0) return null;
	return (
		<div className="flex items-start gap-2 overflow-x-auto scrollbar-hidden pt-1.5 pr-2">
			{pastedTexts.map((p) => (
				<PastedTextChip key={p.id} pasted={p} onRemove={() => onRemove(p.id)} />
			))}
		</div>
	);
}
