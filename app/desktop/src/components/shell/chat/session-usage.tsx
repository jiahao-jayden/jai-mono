import { Popover } from "@base-ui/react/popover";
import { cn } from "cn";
import { useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { Elevated } from "@/lib/elevated";
import { useIcons } from "@/lib/icon-context";
import type { DesktopSessionUsage } from "../../../../shared/desktop-rpc";
import { EMPTY_DESKTOP_SESSION_USAGE } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";

export function isEmptySessionUsage(usage: DesktopSessionUsage): boolean {
	return (
		usage.inputTokens === 0 &&
		usage.outputTokens === 0 &&
		usage.cacheReadTokens === 0 &&
		usage.cacheWriteTokens === 0 &&
		usage.totalTokens === 0 &&
		usage.cost === 0
	);
}

export function formatSessionCost(cost: number): string {
	if (cost === 0) return "$0";
	if (cost >= 1) return `$${cost.toFixed(2)}`;
	const text = cost.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
	return `$${text}`;
}

export function formatSessionTokens(value: number): string {
	return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

export function SessionUsageButton({
	usage = EMPTY_DESKTOP_SESSION_USAGE,
}: {
	readonly usage?: DesktopSessionUsage;
}) {
	const intl = useIntl();
	const icons = useIcons();
	const AnalyticsIcon = icons.analytics;
	const [open, setOpen] = useState(false);
	const empty = isEmptySessionUsage(usage);
	const triggerLabel = empty
		? intl.formatMessage(desktopMessages.sessionUsageEmptyTrigger)
		: intl.formatMessage(desktopMessages.sessionUsageTrigger, {
				tokens: formatSessionTokens(usage.totalTokens),
				cost: formatSessionCost(usage.cost),
			});
	const cacheTokens = usage.cacheReadTokens + usage.cacheWriteTokens;

	return (
		<Popover.Root open={open} onOpenChange={setOpen} modal={false}>
			<Popover.Trigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="chip"
						active={open}
						aria-label={intl.formatMessage(desktopMessages.sessionUsageAria)}
						className="min-w-0 max-w-52 justify-start"
						contentClassName="min-w-0"
						labelClassName="flex min-w-0 items-center gap-1.5 whitespace-nowrap"
					/>
				}
			>
				<AnalyticsIcon size={14} className="shrink-0 opacity-60" />
				<span className="min-w-0 truncate">{triggerLabel}</span>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner side="top" align="end" sideOffset={8} className="z-50 outline-none">
					<Popover.Popup
						render={<Elevated offset={2} shadowLevel={5} />}
						className="flex w-[min(240px,calc(100vw-32px))] flex-col gap-2 overflow-hidden rounded-lg bg-popover p-3 outline-none transition-[opacity,transform] duration-150 ease-out data-starting-style:scale-[.96] data-starting-style:translate-y-[-2px] data-starting-style:opacity-0 data-ending-style:scale-[.96] data-ending-style:translate-y-[-2px] data-ending-style:opacity-0"
					>
						<div className="text-[13px] font-medium text-foreground">
							{intl.formatMessage(desktopMessages.sessionUsageTitle)}
						</div>
						{empty ? (
							<p className="text-[12.5px] leading-5 text-muted-foreground">
								{intl.formatMessage(desktopMessages.sessionUsageEmpty)}
							</p>
						) : (
							<ul className="flex flex-col gap-1.5 text-[12.5px]">
								<UsageRow
									label={intl.formatMessage(desktopMessages.sessionUsageTotal)}
									value={formatSessionTokens(usage.totalTokens)}
									emphasized
								/>
								<UsageRow
									label={intl.formatMessage(desktopMessages.sessionUsageInput)}
									value={formatSessionTokens(usage.inputTokens)}
								/>
								<UsageRow
									label={intl.formatMessage(desktopMessages.sessionUsageOutput)}
									value={formatSessionTokens(usage.outputTokens)}
								/>
								<UsageRow
									label={intl.formatMessage(desktopMessages.sessionUsageCache)}
									value={formatSessionTokens(cacheTokens)}
								/>
								<UsageRow
									label={intl.formatMessage(desktopMessages.sessionUsageCost)}
									value={formatSessionCost(usage.cost)}
									emphasized
								/>
							</ul>
						)}
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

function UsageRow({
	label,
	value,
	emphasized = false,
}: {
	readonly label: string;
	readonly value: string;
	readonly emphasized?: boolean;
}) {
	return (
		<li className="flex items-center justify-between gap-3">
			<span className="text-muted-foreground">{label}</span>
			<span className={cn("tabular-nums text-foreground", emphasized && "font-medium")}>{value}</span>
		</li>
	);
}
