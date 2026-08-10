import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import spinners from "unicode-animations/braille";
import { useIcons } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { DesktopAgentStatus, DesktopArtifact, DesktopTodoItem, DesktopTodos } from "../../../shared/desktop-rpc";
import { Button } from "../ui/button";

interface TaskPanelProps {
	status: DesktopAgentStatus;
	todos?: DesktopTodos;
	artifacts: readonly DesktopArtifact[];
	selectedArtifactId: string | null;
	onOpenArtifact(artifact: DesktopArtifact): void;
}

export function TaskPanel({ status, todos, artifacts, selectedArtifactId, onOpenArtifact }: TaskPanelProps) {
	const icons = useIcons();
	const reduceMotion = useReducedMotion();
	const ChevronRightIcon = icons["chevron-right"];
	const ArchiveIcon = icons.archive;
	const FileCodeIcon = icons["file-code"];
	const HtmlIcon = icons["rectangle-horizontal"];
	const todoItems = todos?.items ?? [];
	const completedTodos = todoItems.filter((item) => item.status === "completed").length;
	const cancelledTodos = todoItems.filter((item) => item.status === "cancelled").length;
	const resolvedTodos = completedTodos + cancelledTodos;
	const hasInProgressTodo = todoItems.some((item) => item.status === "in_progress");
	const progressSummary = `${resolvedTodos} of ${todoItems.length} resolved`;
	const allTodosResolved = todoItems.length > 0 && resolvedTodos === todoItems.length;
	const terminalSummary =
		cancelledTodos > 0 ? `${completedTodos} completed · ${cancelledTodos} cancelled` : "Complete";
	const progressLabel =
		todoItems.length === 0
			? "No active Todo"
			: status === "idle" && hasInProgressTodo
				? `Interrupted · ${progressSummary}`
				: allTodosResolved
					? terminalSummary
					: progressSummary;
	const summaryInitial = reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(18%)" };

	return (
		<aside className="h-full w-full min-w-0 overflow-y-auto bg-background py-3 pr-3">
			<div className="overflow-hidden rounded-[14px] border border-border bg-card">
				<section className="px-4 pt-3.5 pb-2.5">
					<div className="flex items-center justify-between">
						<h2 className="text-[14px] font-semibold">Progress</h2>
						<span aria-live="polite" className="flex items-center gap-2 text-[12.5px] text-foreground/70">
							<AnimatePresence mode="popLayout" initial={false}>
								<motion.span
									key={progressLabel}
									initial={summaryInitial}
									animate={{ opacity: 1, transform: "translateY(0%)" }}
									exit={{ opacity: 0 }}
									transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
								>
									{progressLabel}
								</motion.span>
							</AnimatePresence>
							<ChevronRightIcon size={13} />
						</span>
					</div>
					{todoItems.length > 0 ? (
						<ul className="mt-3 space-y-0.5" aria-label="Session tasks">
							<AnimatePresence initial={false}>
								{todoItems.map((todo) => (
									<TodoRow key={todo.id} todo={todo} agentStatus={status} />
								))}
							</AnimatePresence>
						</ul>
					) : null}
				</section>

				<div aria-hidden="true" className="mx-4 border-t border-border/45" />

				<section className="px-4 py-2.5">
					<div className="flex items-center justify-between pb-2">
						<h2 className="text-[14px] font-semibold">Outputs</h2>
						<ChevronRightIcon size={13} className="rotate-90 text-muted-foreground" />
					</div>
					<p className="py-2 text-[12.5px] leading-relaxed text-foreground/70">
						Agent 生成或修改的文件会出现在这里。
					</p>
				</section>

				<div aria-hidden="true" className="mx-4 border-t border-border/45" />

				<section className="px-4 pt-2.5 pb-3.5">
					<div className="flex items-center justify-between">
						<h2 className="text-[14px] font-semibold">Artifacts</h2>
						<span className="flex items-center gap-1.5 text-[12px] tabular-nums text-muted-foreground">
							{artifacts.length}
							<ArchiveIcon size={14} />
						</span>
					</div>
					{artifacts.length === 0 ? (
						<p className="py-3 text-[12.5px] leading-relaxed text-foreground/70">
							生成的 Markdown 和 HTML 会显示在这里。
						</p>
					) : (
						<ul className="mt-2 max-h-44 space-y-1 overflow-y-auto" aria-label="Session artifacts">
							{artifacts.map((artifact) => {
								const isSelected = artifact.id === selectedArtifactId;
								const ArtifactIcon = artifact.format === "html" ? HtmlIcon : FileCodeIcon;
								return (
									<li key={artifact.id}>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											active={isSelected}
											onClick={() => onOpenArtifact(artifact)}
											aria-current={isSelected ? "true" : undefined}
											className="h-auto w-full justify-start rounded-[8px] px-2 py-1.5"
											contentClassName="w-full min-w-0 justify-start"
											labelClassName="flex min-w-0 flex-1 items-center gap-2"
										>
											<ArtifactIcon size={14} className="shrink-0 text-muted-foreground" />
											<span className="min-w-0 flex-1 truncate text-left text-[12px]" title={artifact.path}>
												{artifactName(artifact.path)}
											</span>
											<span className="shrink-0 text-[10px] font-medium uppercase text-muted-foreground">
												{artifact.format}
											</span>
										</Button>
									</li>
								);
							})}
						</ul>
					)}
				</section>
			</div>
		</aside>
	);
}

function artifactName(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function TodoRow({ todo, agentStatus }: { readonly todo: DesktopTodoItem; readonly agentStatus: DesktopAgentStatus }) {
	const reduceMotion = useReducedMotion();
	const isCompleted = todo.status === "completed";
	const isCancelled = todo.status === "cancelled";
	const isInterrupted = todo.status === "in_progress" && agentStatus === "idle";
	const ariaCurrent = todo.status === "in_progress" && !isInterrupted ? "step" : undefined;
	const initial = reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(-22%)" };
	const exit = reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "translateY(-18%)" };

	return (
		<motion.li
			layout="position"
			initial={initial}
			animate={{ opacity: 1, transform: "translateY(0%)" }}
			exit={exit}
			transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
			className="flex min-h-8 items-center gap-2.5"
			aria-current={ariaCurrent}
		>
			<TodoStatusIndicator status={todo.status} interrupted={isInterrupted} />
			<span className="min-w-0 flex-1 text-[12.5px] leading-5">
				<span
					className={cn("relative inline-block max-w-full truncate align-middle", {
						"text-foreground": todo.status === "in_progress",
						"text-foreground/70": todo.status === "pending",
						"text-foreground/65": isCompleted || isCancelled,
						"line-through decoration-foreground/35": isCancelled,
					})}
					title={todo.content}
				>
					{todo.content}
					{isCompleted ? (
						<motion.span
							aria-hidden="true"
							className="absolute inset-x-0 top-1/2 h-px origin-left bg-foreground/35"
							initial={{ transform: "scaleX(0)" }}
							animate={{ transform: "scaleX(1)" }}
							transition={{ duration: reduceMotion ? 0.12 : 0.22, ease: [0.23, 1, 0.32, 1] }}
						/>
					) : null}
				</span>
			</span>
		</motion.li>
	);
}

function TodoStatusIndicator({
	status,
	interrupted,
}: {
	readonly status: DesktopTodoItem["status"];
	readonly interrupted: boolean;
}) {
	const icons = useIcons();
	const reduceMotion = useReducedMotion();
	const CheckIcon = icons.check;
	const PauseIcon = icons.pause;
	const XIcon = icons.x;
	const statusLabel = interrupted
		? "Interrupted"
		: status === "completed"
			? "Completed"
			: status === "in_progress"
				? "In progress"
				: status === "cancelled"
					? "Cancelled"
					: "Pending";

	if (status === "completed") {
		const initial = reduceMotion ? { opacity: 0 } : { opacity: 0, transform: "scale(0.92)" };
		return (
			<motion.span
				key={status}
				initial={initial}
				animate={{ opacity: 1, transform: "scale(1)" }}
				transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
				className="flex size-4 shrink-0 items-center justify-center rounded-[5px] bg-primary-2 text-primary-2-foreground shadow-[0_1px_2px_color-mix(in_oklch,var(--primary-2)_28%,transparent)]"
				aria-label={statusLabel}
				role="img"
			>
				<CheckIcon size={11} strokeWidth={2.2} />
			</motion.span>
		);
	}
	if (interrupted) {
		return (
			<span
				className="flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-border text-muted-foreground"
				aria-label={statusLabel}
				role="img"
			>
				<PauseIcon size={9} strokeWidth={1.8} />
			</span>
		);
	}
	if (status === "in_progress") {
		return (
			<span
				className="flex size-4 shrink-0 items-center justify-center text-primary-2"
				aria-label={statusLabel}
				role="img"
			>
				<UnicodeLoadingIndicator />
			</span>
		);
	}
	if (status === "cancelled") {
		return (
			<span
				className="flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-border text-muted-foreground/70"
				aria-label={statusLabel}
				role="img"
			>
				<XIcon size={10} strokeWidth={1.8} />
			</span>
		);
	}
	return (
		<span
			className="size-4 shrink-0 rounded-[5px] border border-border bg-background/70"
			aria-label={statusLabel}
			role="img"
		/>
	);
}

function UnicodeLoadingIndicator() {
	const reduceMotion = useReducedMotion();
	const [frameIndex, setFrameIndex] = useState(0);
	const spinner = spinners.orbit;

	useEffect(() => {
		setFrameIndex(0);
		if (reduceMotion) return;
		const timer = window.setInterval(() => {
			setFrameIndex((current) => (current + 1) % spinner.frames.length);
		}, spinner.interval);
		return () => window.clearInterval(timer);
	}, [reduceMotion]);

	return (
		<span aria-hidden="true" className="font-mono text-[15px] leading-none">
			{spinner.frames[frameIndex]}
		</span>
	);
}
