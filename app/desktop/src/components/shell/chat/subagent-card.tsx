import { useIcons } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type { DesktopSubagentItem } from "../../../../shared/desktop-rpc";
import { NextStep } from "../../ui/next-step";

export function SubagentCard({ item }: { readonly item: DesktopSubagentItem }) {
	const icons = useIcons();
	const running = item.status === "running";
	const complete = item.status === "complete";
	const StatusIcon = running ? icons.sparkles : complete ? icons.check : icons["shield-alert"];
	const statusLabel = running ? "Running" : complete ? "Done" : "Failed";
	const fallbackActivity = running ? "Preparing delegated task…" : complete ? "Task completed" : "Task stopped";
	const activityTitle = item.activityTitle ?? fallbackActivity;
	const cardClassName = cn(
		"w-full overflow-hidden rounded-[14px] border px-3.5 py-3 transition-colors duration-150",
		running && "border-primary-2/15 bg-primary-2/[0.025]",
		complete && "border-border/55 bg-card/55",
		item.status === "error" && "border-destructive/15 bg-destructive/[0.025]",
	);
	const iconClassName = cn(
		"flex size-8 shrink-0 items-center justify-center rounded-full",
		running && "bg-primary-2/10 text-primary-2",
		complete && "bg-foreground/5 text-muted-foreground",
		item.status === "error" && "bg-destructive/8 text-destructive",
	);
	const statusClassName = cn(
		"flex shrink-0 items-center gap-1.5 text-[11.5px]",
		running && "text-primary-2",
		complete && "text-muted-foreground",
		item.status === "error" && "text-destructive",
	);
	const statusDotClassName = cn(
		"size-1.5 rounded-full",
		running && "bg-primary-2",
		complete && "bg-muted-foreground/55",
		item.status === "error" && "bg-destructive",
	);

	return (
		<section aria-label={`Subagent ${item.title}: ${statusLabel}`} className={cardClassName}>
			<div className="flex items-start gap-3">
				<span aria-hidden="true" className={iconClassName}>
					<StatusIcon size={15} strokeWidth={1.7} />
				</span>
				<div className="min-w-0 flex-1 pt-px">
					<div className="flex items-center justify-between gap-3">
						<h3 className="truncate text-[13.5px] font-semibold leading-tight text-foreground">{item.title}</h3>
						<span className={statusClassName}>
							<span aria-hidden="true" className={statusDotClassName} />
							{statusLabel}
						</span>
					</div>
					<NextStep
						value={activityTitle}
						className="mt-1.5 max-w-full text-[12.5px] leading-snug text-muted-foreground"
					/>
				</div>
			</div>
		</section>
	);
}
