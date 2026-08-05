import { AnimatePresence, motion, Reorder, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { fontWeights } from "@/lib/font-weight";
import { useIcon } from "@/lib/icon-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import type { QueuedMessage } from "@/stores/chat";

interface ChatMessageQueueProps {
	readonly messages: readonly QueuedMessage[];
	onEdit(messageId: string): void;
	onRemove(messageId: string): void;
	onReorder(messageIds: readonly string[]): void;
}

export function ChatMessageQueue({ messages, onEdit, onRemove, onReorder }: ChatMessageQueueProps) {
	const reducedMotion = useReducedMotion() ?? false;
	const messageList = [...messages];

	if (messageList.length === 0) return null;

	return (
		<AnimatePresence initial={false}>
			<motion.div
				key="queue-row"
				initial={{ height: 0, opacity: 0 }}
				animate={{ height: "auto", opacity: 1 }}
				exit={{ height: 0, opacity: 0 }}
				transition={{ ...spring.moderate, bounce: 0 }}
				className="overflow-hidden"
			>
				<Reorder.Group
					axis="y"
					values={messageList}
					onReorder={(next) => onReorder(next.map((message) => message.id))}
					className="flex flex-col gap-1 pb-1"
				>
					<AnimatePresence initial={false}>
						{messageList.map((message, index) => (
							<QueuedMessageRow
								key={message.id}
								message={message}
								index={index}
								total={messageList.length}
								reducedMotion={reducedMotion}
								onEdit={onEdit}
								onRemove={onRemove}
							/>
						))}
					</AnimatePresence>
				</Reorder.Group>
			</motion.div>
		</AnimatePresence>
	);
}

interface QueuedMessageRowProps {
	readonly message: QueuedMessage;
	readonly index: number;
	readonly total: number;
	readonly reducedMotion: boolean;
	onEdit(messageId: string): void;
	onRemove(messageId: string): void;
}

function QueuedMessageRow({ message, index, total, reducedMotion, onEdit, onRemove }: QueuedMessageRowProps) {
	const XIcon = useIcon("x");
	const label = message.text;

	return (
		<Reorder.Item
			value={message}
			layout
			initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
			animate={{ opacity: 1, scale: 1 }}
			exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, transition: spring.fast.exit }}
			transition={spring.fast}
			aria-label={`Queued message ${index + 1} of ${total}: ${label}`}
			tabIndex={0}
			onDoubleClick={() => onEdit(message.id)}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === "F2") {
					event.preventDefault();
					onEdit(message.id);
				} else if (event.key === "Delete" || event.key === "Backspace") {
					event.preventDefault();
					onRemove(message.id);
				}
			}}
			className={cn(
				"group/qrow flex h-8 items-center gap-2 rounded-lg bg-muted px-2.5",
				"cursor-grab text-[13px] text-foreground/85 select-none outline-none active:cursor-grabbing",
				"focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
			)}
			style={{ fontVariationSettings: fontWeights.normal }}
		>
			<span className="min-w-0 flex-1 truncate py-1 -my-1 [text-box:trim-both_cap_alphabetic]">{label}</span>
			<Tooltip content="Remove" side="top">
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					onPointerDown={(event) => event.stopPropagation()}
					onClick={(event) => {
						event.stopPropagation();
						onRemove(message.id);
					}}
					aria-label={`Remove queued message: ${label}`}
					className="size-5 shrink-0 text-muted-foreground opacity-100 hover:bg-hover hover:text-foreground sm:opacity-0 sm:group-hover/qrow:opacity-100 sm:focus-visible:opacity-100"
				>
					<XIcon size={13} strokeWidth={2.5} />
				</Button>
			</Tooltip>
		</Reorder.Item>
	);
}
