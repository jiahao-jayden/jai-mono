import { cn } from "cn";
import { AnimatePresence, motion, Reorder, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { useIntl } from "react-intl";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { desktopMessages } from "@/i18n/messages";
import { fontWeights } from "@/lib/font-weight";
import { useIcon } from "@/lib/icon-context";
import { spring } from "@/lib/springs";
import type { QueuedMessage } from "@/stores/chat";

interface ChatMessageQueueProps {
	readonly messages: readonly QueuedMessage[];
	onEdit(messageId: string): void;
	onRemove(messageId: string): void;
	onReorder(messageIds: readonly string[]): void;
	onSteer(message: QueuedMessage): Promise<boolean>;
	readonly steerEnabled: boolean;
}

export function ChatMessageQueue({
	messages,
	onEdit,
	onRemove,
	onReorder,
	onSteer,
	steerEnabled,
}: ChatMessageQueueProps) {
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
				className="relative z-1 -mb-px overflow-hidden rounded-t-xl border border-b-0 border-border-surface bg-muted/45 p-1 pb-1.5"
				data-im-queue
			>
				<Reorder.Group
					axis="y"
					values={messageList}
					onReorder={(next) => onReorder(next.map((message) => message.id))}
					className="flex flex-col gap-0.5"
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
								onSteer={onSteer}
								steerEnabled={steerEnabled}
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
	onSteer(message: QueuedMessage): Promise<boolean>;
	readonly steerEnabled: boolean;
}

function QueuedMessageRow({
	message,
	index,
	total,
	reducedMotion,
	onEdit,
	onRemove,
	onSteer,
	steerEnabled,
}: QueuedMessageRowProps) {
	const intl = useIntl();
	const SteerIcon = useIcon("corner-down-right");
	const EditIcon = useIcon("pencil");
	const DeleteIcon = useIcon("trash");
	const [steering, setSteering] = useState(false);
	const label = message.text;
	const steer = async () => {
		if (!steerEnabled || steering) return;
		setSteering(true);
		await onSteer(message);
		setSteering(false);
	};

	return (
		<Reorder.Item
			value={message}
			layout
			initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97 }}
			animate={{ opacity: 1, scale: 1 }}
			exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, transition: spring.fast.exit }}
			transition={spring.fast}
			aria-label={intl.formatMessage(desktopMessages.queuedMessagePosition, { position: index + 1, total, label })}
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
				"group/qrow flex min-h-8 items-center gap-2 rounded-lg px-2 py-0.5",
				"cursor-grab text-[13px] text-foreground/85 select-none outline-none hover:bg-muted active:cursor-grabbing",
				"focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]",
			)}
			style={{ fontVariationSettings: fontWeights.normal }}
		>
			<SteerIcon size={14} className="shrink-0 text-muted-foreground" />
			<span className="-my-1 min-w-0 flex-1 truncate py-1 [text-box:trim-both_cap_alphabetic]">{label}</span>
			<Button
				type="button"
				variant="secondary"
				size="sm"
				onPointerDown={(event) => event.stopPropagation()}
				onClick={(event) => {
					event.stopPropagation();
					void steer();
				}}
				disabled={!steerEnabled || steering}
				loading={steering}
				leadingIcon={SteerIcon}
				aria-label={intl.formatMessage(desktopMessages.queuedMessageSteer, { label })}
				className="h-6 shrink-0 px-2"
			>
				{intl.formatMessage(desktopMessages.composerSteerMessage)}
			</Button>
			<Tooltip content={intl.formatMessage(desktopMessages.queuedMessageEdit, { label })} side="top">
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					onPointerDown={(event) => event.stopPropagation()}
					onClick={(event) => {
						event.stopPropagation();
						onEdit(message.id);
					}}
					aria-label={intl.formatMessage(desktopMessages.queuedMessageEdit, { label })}
				>
					<EditIcon />
				</Button>
			</Tooltip>
			<Tooltip content={intl.formatMessage(desktopMessages.commonRemove)} side="top">
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					onPointerDown={(event) => event.stopPropagation()}
					onClick={(event) => {
						event.stopPropagation();
						onRemove(message.id);
					}}
					aria-label={intl.formatMessage(desktopMessages.queuedMessageRemove, { label })}
					className="shrink-0"
				>
					<DeleteIcon />
				</Button>
			</Tooltip>
		</Reorder.Item>
	);
}
