import type { Project } from "@jai/coding/business";
import { useIcons } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { DesktopAgentStatus, DesktopTranscriptItem } from "../../../shared/desktop-rpc";

interface TaskPanelProps {
	status: DesktopAgentStatus;
	items: readonly DesktopTranscriptItem[];
	project?: Project;
}

export function TaskPanel({ status, items, project }: TaskPanelProps) {
	const icons = useIcons();
	const ChevronRightIcon = icons["chevron-right"];
	const FileCodeIcon = icons["file-code"];
	const FolderOpenIcon = icons["folder-open"];
	const LayersIcon = icons.layers;
	const TerminalIcon = icons.terminal;
	const tools = items.filter((item) => item.kind === "tool");
	const completedTools = tools.filter((item) => item.status === "complete").length;
	const outputCandidates = tools.filter(
		(item) => item.status === "complete" && ["Write", "Edit"].includes(item.toolName),
	);

	return (
		<aside className="h-full w-84 shrink-0 overflow-y-auto bg-background py-3 pr-3">
			<div className="overflow-hidden rounded-[14px] border border-border bg-card">
				<section className="px-4 pt-3.5 pb-2.5">
					<div className="flex items-center justify-between">
						<h2 className="text-[14px] font-semibold">Progress</h2>
						<span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
							{status === "running" ? (
								<>
									<span className="size-1.5 animate-pulse rounded-full bg-primary-2" />
									Agent is working
								</>
							) : (
								`${completedTools} completed`
							)}
							<ChevronRightIcon size={13} />
						</span>
					</div>
					{tools.length > 0 ? (
						<div className="mt-3 space-y-1.5">
							{tools.slice(-4).map((tool) => (
								<div key={tool.id} className="flex items-center gap-2 text-[12.5px]">
									<TerminalIcon size={13} className="shrink-0 text-muted-foreground" />
									<span className="min-w-0 flex-1 truncate">{tool.summary || tool.toolName}</span>
									<span
										className={cn({
											"text-destructive": tool.status === "error",
											"text-muted-foreground": tool.status !== "error",
										})}
									>
										{tool.status}
									</span>
								</div>
							))}
						</div>
					) : null}
				</section>

				<div aria-hidden="true" className="mx-4 border-t border-border/45" />

				<section className="px-4 py-2.5">
					<div className="flex items-center justify-between pb-2">
						<div className="flex items-baseline gap-2">
							<h2 className="text-[14px] font-semibold">Outputs</h2>
							<span className="text-[12.5px] text-muted-foreground">{outputCandidates.length}</span>
						</div>
						<ChevronRightIcon size={13} className="rotate-90 text-muted-foreground" />
					</div>
					{outputCandidates.length > 0 ? (
						<div>
							{outputCandidates.map((tool) => (
								<div
									key={tool.id}
									className="flex items-center gap-2.5 rounded-lg px-1.5 py-2 transition-colors hover:bg-muted"
								>
									<span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground">
										<FileCodeIcon size={14} />
									</span>
									<span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">
										{tool.summary || `${tool.toolName} output`}
									</span>
								</div>
							))}
						</div>
					) : (
						<p className="py-2 text-[12.5px] leading-relaxed text-muted-foreground">
							Agent 生成或修改的文件会出现在这里。
						</p>
					)}
				</section>

				<div aria-hidden="true" className="mx-4 border-t border-border/45" />

				<section className="px-4 pt-2.5 pb-3.5">
					<div className="flex items-center justify-between">
						<h2 className="text-[14px] font-semibold">Project</h2>
						<LayersIcon size={14} className="text-muted-foreground" />
					</div>
					<div className="mt-4 flex justify-center">
						<div className="relative h-12 w-32" aria-hidden="true">
							<span className="absolute left-1 top-2 flex h-9 w-12 -rotate-6 items-center justify-center rounded-md border border-border bg-background">
								<FileCodeIcon size={14} className="text-muted-foreground" />
							</span>
							<span className="absolute left-10 top-1 flex h-10 w-12 items-center justify-center rounded-md border border-border bg-background">
								<TerminalIcon size={14} className="text-muted-foreground" />
							</span>
							<span className="absolute right-1 top-0 flex h-11 w-14 rotate-6 items-center justify-center rounded-md border border-primary-2/25 bg-primary-2/8 text-primary-2">
								<FolderOpenIcon size={16} />
							</span>
						</div>
					</div>
					<div className="mt-2 text-center">
						<p className="truncate text-[12.5px] font-medium">{project?.displayName ?? "No project"}</p>
						<p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
							{project ? project.path : "此会话没有本地文件访问上下文。"}
						</p>
					</div>
				</section>
			</div>
		</aside>
	);
}
