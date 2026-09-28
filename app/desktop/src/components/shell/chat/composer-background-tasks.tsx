import { cn } from "cn";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcon, useIcons } from "@/lib/icon-context";
import { spring } from "@/lib/springs";
import type { DesktopSubagentItem } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { SubagentAvatar } from "../subagent-avatar";

/** Matches `InputMessage`'s `rounded-[26px]`; the tab tucks this far under the composer so its top corners sit on the tab fill. */
const COMPOSER_RADIUS = 26;

export function ComposerBackgroundTasks({
	items,
	inset,
	onOpenSubagent,
	onStopSubagent,
}: {
	readonly items: readonly DesktopSubagentItem[];
	/** Narrows the tab when another composer tab (the message queue) sits directly below it. */
	readonly inset: boolean;
	readonly onOpenSubagent?: (item: DesktopSubagentItem) => void;
	readonly onStopSubagent: (item: DesktopSubagentItem) => void;
}) {
	const intl = useIntl();
	const icons = useIcons();
	const StopIcon = icons.stop;
	const ChevronIcon = useIcon("chevron-down");
	const [expanded, setExpanded] = useState(false);

	const toggleLabel = intl.formatMessage(
		expanded ? desktopMessages.backgroundTasksCollapse : desktopMessages.backgroundTasksExpand,
	);

	return (
		<AnimatePresence initial={false}>
			{items.length > 0 ? (
				<motion.div
					key="background-tasks"
					initial={{ height: 0, marginBottom: 0, opacity: 0 }}
					animate={{ height: "auto", marginBottom: inset ? -1 : -COMPOSER_RADIUS, opacity: 1 }}
					exit={{ height: 0, marginBottom: 0, opacity: 0 }}
					transition={{ ...spring.moderate, bounce: 0 }}
					className={cn(
						"relative overflow-hidden rounded-t-2xl border border-b-0 border-border-surface bg-muted/45",
						{ "mx-3": inset },
					)}
				>
					<div className={cn("p-1", inset ? "pb-1.5" : "pb-8")}>
						<button
							type="button"
							onClick={() => setExpanded((current) => !current)}
							aria-expanded={expanded}
							aria-label={toggleLabel}
							className={cn(
								"flex min-h-7 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-muted-foreground outline-none",
								"focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]",
							)}
						>
							<span className="shimmer-text min-w-0 flex-1 truncate text-[12px]">
								{intl.formatMessage(desktopMessages.backgroundTasksRunning, { count: items.length })}
							</span>
							<ChevronIcon
								className={cn("size-3.5 shrink-0 transition-transform duration-200", {
									"rotate-180": expanded,
								})}
							/>
						</button>
						<AnimatePresence initial={false}>
							{expanded ? (
								<motion.ul
									key="background-task-list"
									initial={{ height: 0, opacity: 0 }}
									animate={{ height: "auto", opacity: 1 }}
									exit={{ height: 0, opacity: 0 }}
									transition={{ ...spring.moderate, bounce: 0 }}
									className="flex flex-col gap-0.5 overflow-hidden"
									aria-label={toggleLabel}
								>
									{items.map((item) => (
										<li key={item.id} className="flex min-h-8 min-w-0 items-center gap-2 px-2 py-0.5">
											<button
												type="button"
												disabled={!onOpenSubagent}
												onClick={() => onOpenSubagent?.(item)}
												className={cn(
													"flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md text-left outline-none disabled:cursor-default",
													"focus-visible:ring-1 focus-visible:ring-[color:var(--ring)]",
												)}
											>
												<SubagentAvatar item={item} size={16} />
												<span
													className="min-w-0 max-w-1/2 truncate text-[13px] leading-4 text-foreground/85"
													title={item.title}
												>
													{item.title}
												</span>
												<span className="min-w-0 flex-1 truncate text-[12px] leading-4 text-muted-foreground">
													{item.activityTitle}
												</span>
											</button>
											<Button
												type="button"
												variant="ghost"
												size="icon-xs"
												className="shrink-0 text-muted-foreground hover:text-foreground"
												aria-label={intl.formatMessage(desktopMessages.subagentStop, { title: item.title })}
												onClick={() => onStopSubagent(item)}
											>
												<StopIcon className="block !size-[11px] [&_path]:fill-current [&_path]:stroke-none" />
											</Button>
										</li>
									))}
								</motion.ul>
							) : null}
						</AnimatePresence>
					</div>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}
