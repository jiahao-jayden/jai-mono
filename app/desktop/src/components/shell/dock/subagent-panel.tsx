import { cn } from "cn";
import { type ReactNode, useEffect, useRef } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import type { DesktopSubagentItem } from "../../../../shared/desktop-rpc";
import { NextStep } from "../../ui/next-step";
import { SubagentAvatar } from "../subagent-avatar";

export function SubagentPanel({
	items,
	selectedId = null,
}: {
	readonly items: readonly DesktopSubagentItem[];
	readonly selectedId?: string | null;
}) {
	const intl = useIntl();
	const active = items.filter((item) => item.status === "running");
	const settled = items.filter((item) => item.status !== "running");

	return (
		<section
			id="dock-subagent-panel"
			aria-label={intl.formatMessage(desktopMessages.dockSubagentPanel)}
			className="flex h-full min-w-0 flex-col gap-4 overflow-y-auto px-3 pb-3"
		>
			<SubagentGroup
				label={intl.formatMessage(desktopMessages.subagentActive)}
				items={active}
				selectedId={selectedId}
			>
				<p className="px-1 text-[13px] text-muted-foreground">
					{intl.formatMessage(desktopMessages.subagentPanelEmpty)}
				</p>
			</SubagentGroup>
			{settled.length > 0 ? (
				<SubagentGroup
					label={intl.formatMessage(desktopMessages.subagentComplete)}
					items={settled}
					selectedId={selectedId}
				/>
			) : null}
		</section>
	);
}

function SubagentGroup({
	label,
	items,
	selectedId,
	children,
}: {
	readonly label: string;
	readonly items: readonly DesktopSubagentItem[];
	readonly selectedId: string | null;
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
				<ul className="flex flex-col gap-0.5" aria-label={label}>
					{items.map((item) => (
						<SubagentRow key={item.id} item={item} selected={item.id === selectedId} />
					))}
				</ul>
			) : null}
		</section>
	);
}

function SubagentRow({ item, selected }: { readonly item: DesktopSubagentItem; readonly selected: boolean }) {
	const intl = useIntl();
	const ref = useRef<HTMLLIElement>(null);
	const running = item.status === "running";
	const complete = item.status === "complete";
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
	const rowClassName = cn(
		"flex min-w-0 flex-col gap-1 rounded-lg px-2 py-2 transition-colors duration-150",
		selected && "bg-sidebar-active",
	);
	const activityClassName = cn(
		"max-w-full text-[12px] leading-4 text-muted-foreground",
		running && "shimmer-text",
		item.status === "error" && "text-destructive",
	);

	useEffect(() => {
		if (selected) ref.current?.scrollIntoView({ block: "nearest" });
	}, [selected]);

	return (
		<li
			ref={ref}
			className={rowClassName}
			aria-current={selected ? "true" : undefined}
			aria-label={intl.formatMessage(desktopMessages.subagentAria, { title: item.title, status: statusLabel })}
		>
			<div className="flex min-w-0 items-center gap-2.5">
				<SubagentAvatar item={item} size={20} />
				<p className="min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-foreground" title={item.title}>
					{item.title}
				</p>
			</div>
			<NextStep value={item.activityTitle ?? fallbackActivity} className={cn(activityClassName, "pl-[30px]")} />
		</li>
	);
}
