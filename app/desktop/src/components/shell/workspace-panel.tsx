import type { Project } from "@jai/coding/business";
import { useState } from "react";
import { useIcons } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { DesktopAgentStatus, DesktopTodos } from "../../../shared/desktop-rpc";
import { Button } from "../ui/button";
import { TabItem, TabPanel, Tabs, TabsList } from "../ui/tabs";

interface WorkspacePanelProps {
	status: DesktopAgentStatus;
	todos?: DesktopTodos;
	project?: Project;
}

export function WorkspacePanel({ status, todos, project }: WorkspacePanelProps) {
	const icons = useIcons();
	const FileCodeIcon = icons["file-code"];
	const FolderIcon = icons["folder-open"];
	const PlusIcon = icons.plus;
	const [activeTab, setActiveTab] = useState("preview");
	const todoItems = todos?.items ?? [];
	const resolvedTodoCount = todoItems.filter(
		(item) => item.status === "completed" || item.status === "cancelled",
	).length;
	const projectName = project?.displayName ?? "No project";
	const projectPath = project?.path ?? "No local project path";
	const previewPath = project?.path ?? "/";
	const statusLabel = status === "running" ? "Agent working" : "Agent idle";
	const statusDotClass = cn("size-1.5 rounded-full", {
		"bg-primary-2": status === "running",
		"bg-muted-foreground/55": status === "idle",
	});
	const todoSummary =
		todoItems.length === 0 ? "No active Todo" : `${resolvedTodoCount} of ${todoItems.length} resolved`;

	return (
		<aside
			id="workspace-panel"
			aria-label="Workspace"
			className="h-full w-full min-w-0 overflow-y-auto bg-background py-3 pr-3"
		>
			<div className="flex min-h-full flex-col overflow-hidden rounded-[14px] border border-border bg-card">
				<Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
					<div className="flex h-13 shrink-0 items-center border-b border-border/45 bg-muted/30 px-2">
						<TabsList
							aria-label="Workspace views"
							className="flex min-w-0 flex-1 justify-start gap-1 bg-transparent p-0"
							indicatorClassName="bg-muted shadow-none"
						>
							<TabItem
								value="preview"
								icon={FileCodeIcon}
								label="Open file"
								className="h-9 max-w-40 min-w-0 rounded-[10px] px-3"
							/>
							<TabItem
								value="context"
								icon={FolderIcon}
								label="Context"
								className="h-9 max-w-36 min-w-0 rounded-[10px] px-3"
							/>
						</TabsList>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={() => setActiveTab("preview")}
							aria-label="Open file tab"
							title="Open file"
							className="ml-1 shrink-0 text-muted-foreground"
						>
							<PlusIcon size={16} />
						</Button>
					</div>

					<div className="min-h-0 flex-1 overflow-y-auto">
						<TabPanel value="preview" className="h-full min-h-[360px]">
							<div className="flex h-full min-h-[360px] flex-col">
								<div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/45 px-3 text-[12px] text-foreground/65">
									<FolderIcon size={14} className="shrink-0" />
									<span className="min-w-0 truncate" title={previewPath}>
										{previewPath}
									</span>
								</div>
								<div className="flex flex-1 flex-col items-center justify-center px-5 py-10 text-center">
									<span
										aria-hidden="true"
										className="flex size-10 items-center justify-center text-muted-foreground"
									>
										<FolderIcon size={24} />
									</span>
									<h3 className="mt-3 text-[13px] font-semibold">Open a file</h3>
									<p className="mt-2 max-w-56 text-[12px] leading-5 text-foreground/65">
										Select a file to preview it here.
									</p>
								</div>
							</div>
						</TabPanel>

						<TabPanel value="context" className="space-y-5 p-4">
							<section className="border-b border-border/45 pb-4">
								<h3 className="text-[13px] font-semibold">Session context</h3>
								<dl className="mt-4 space-y-3 text-[12px]">
									<div className="flex items-start justify-between gap-4">
										<dt className="shrink-0 text-foreground/60">Project</dt>
										<dd className="min-w-0 truncate text-right font-medium" title={projectName}>
											{projectName}
										</dd>
									</div>
									<div className="flex items-start justify-between gap-4">
										<dt className="shrink-0 text-foreground/60">Path</dt>
										<dd className="min-w-0 break-all text-right text-foreground/75" title={projectPath}>
											{projectPath}
										</dd>
									</div>
									<div className="flex items-center justify-between gap-4">
										<dt className="shrink-0 text-foreground/60">Status</dt>
										<dd className="flex items-center gap-2 font-medium">
											<span aria-hidden="true" className={statusDotClass} />
											{statusLabel}
										</dd>
									</div>
								</dl>
							</section>

							<section>
								<h3 className="text-[13px] font-semibold">Todo</h3>
								<p className="mt-3 text-[12px] leading-5 text-foreground/70">{todoSummary}</p>
							</section>
						</TabPanel>
					</div>
				</Tabs>
			</div>
		</aside>
	);
}
