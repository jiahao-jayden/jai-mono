import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcons } from "@/lib/icon-context";
import { cn } from "cn";
import type { DesktopSubagentItem } from "../../../../shared/desktop-rpc";
import { NextStep } from "../../ui/next-step";

export function SubagentPanel({ items }: { readonly items: readonly DesktopSubagentItem[] }) {
	const intl = useIntl();
	const active = items.filter((item) => item.status === "running");
	const settled = items.filter((item) => item.status !== "running");

	return (
		<section
			id="dock-subagent-panel"
			aria-label={intl.formatMessage(desktopMessages.dockSubagentPanel)}
			className="flex h-full min-w-0 flex-col gap-4 overflow-y-auto px-3 pb-3"
		>
			<SubagentGroup label={intl.formatMessage(desktopMessages.subagentActive)} items={active}>
				<p className="px-1 text-[13px] text-muted-foreground">
					{intl.formatMessage(desktopMessages.subagentPanelEmpty)}
				</p>
			</SubagentGroup>
			{settled.length > 0 ? (
				<SubagentGroup label={intl.formatMessage(desktopMessages.subagentComplete)} items={settled} />
			) : null}
		</section>
	);
}

function SubagentGroup({
	label,
	items,
	children,
}: {
	readonly label: string;
	readonly items: readonly DesktopSubagentItem[];
	readonly children?: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-1.5">
			<h2 className="flex h-6 items-center gap-1.5 px-1 text-[12px] font-medium text-muted-foreground">
				{label}
				<span aria-hidden="true">·</span>
				<span className="tabular-nums">{items.length}</span>
			</h2>
			{items.length === 0 ? children : null}
			{items.length > 0 ? (
				<ul className="flex flex-col gap-1" aria-label={label}>
					{items.map((item) => (
						<SubagentRow key={item.id} item={item} />
					))}
				</ul>
			) : null}
		</section>
	);
}

function SubagentRow({ item }: { readonly item: DesktopSubagentItem }) {
	const intl = useIntl();
	const icons = useIcons();
	const running = item.status === "running";
	const complete = item.status === "complete";
	const StatusIcon = running ? icons.loader : complete ? icons.check : icons["shield-alert"];
	const statusLabel = intl.formatMessage(
		running
			? desktopMessages.subagentRunning
			: complete
				? desktopMessages.subagentDone
				: desktopMessages.subagentFailed,
	);
	const fallbackActivity = intl.formatMessage(
		running
			? desktopMessages.subagentPreparing
			: complete
				? desktopMessages.subagentCompleted
				: desktopMessages.subagentStopped,
	);

	return (
		<li
			className="flex min-w-0 items-start gap-2.5 rounded-lg px-1 py-1"
			aria-label={intl.formatMessage(desktopMessages.subagentAria, { title: item.title, status: statusLabel })}
		>
			<span
				role="img"
				aria-label={statusLabel}
				className={cn("flex size-4 shrink-0 items-center justify-center pt-0.5", {
					"text-foreground": running,
					"text-muted-foreground": complete,
					"text-destructive": item.status === "error",
				})}
			>
				<StatusIcon size={13} strokeWidth={1.8} className={cn({ "animate-spin": running })} />
			</span>
			<div className="min-w-0 flex-1">
				<p className="truncate text-[13px] leading-5 text-foreground" title={item.title}>
					{item.title}
				</p>
				<NextStep
					value={item.activityTitle ?? fallbackActivity}
					className="max-w-full text-[12px] leading-4 text-muted-foreground"
				/>
			</div>
		</li>
	);
}
