import { Popover } from "@base-ui/react/popover";
import { cn } from "cn";
import { useState } from "react";
import { type MessageDescriptor, useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { Elevated } from "@/lib/elevated";
import { notifyFailure } from "@/lib/failure";
import { useIcons } from "@/lib/icon-context";
import type { DesktopFailure, DesktopSessionContext, DesktopSessionUsage } from "../../../../shared/desktop-rpc";
import { EMPTY_DESKTOP_SESSION_USAGE } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
export function isEmptySessionUsage(usage: DesktopSessionUsage): boolean {
	return (
		usage.inputTokens === 0 &&
		usage.outputTokens === 0 &&
		usage.cacheReadTokens === 0 &&
		usage.cacheWriteTokens === 0 &&
		usage.totalTokens === 0
	);
}

export function formatSessionTokens(value: number): string {
	return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

const RING_RADIUS = 6.5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
export function resolveContextRatio(contextTokens: number, contextWindow: number | undefined): number {
	if (!contextWindow || contextWindow <= 0) return 0;
	return Math.min(1, Math.max(0, contextTokens / contextWindow));
}

export type SessionContextCategory = keyof DesktopSessionContext["categories"] | "toolOutputs";

export interface SessionContextShare {
	readonly tokens: number;
	/** Fraction of the measured request, in [0, 1]. */
	readonly share: number;
}

export interface SessionContextRow extends SessionContextShare {
	readonly category: SessionContextCategory;
	readonly tools: readonly (SessionContextShare & { readonly toolName: string })[];
}

/**
 * Category figures are estimates, so only their proportions are shown; the
 * provider-reported `usedTokens` is the one absolute total they are scaled to.
 */
export function resolveContextBreakdown(context: DesktopSessionContext): readonly SessionContextRow[] {
	const toolOutputs = context.toolOutputs.reduce((sum, tool) => sum + tool.tokens, 0);
	const estimates: [SessionContextCategory, number][] = [
		...(Object.entries(context.categories) as [SessionContextCategory, number][]),
		["toolOutputs", toolOutputs],
	];
	const total = estimates.reduce((sum, [, estimate]) => sum + estimate, 0);
	if (total <= 0) return [];
	const scale = (estimate: number): SessionContextShare => ({
		share: estimate / total,
		tokens: Math.round((estimate / total) * context.usedTokens),
	});
	return estimates
		.filter(([, estimate]) => estimate > 0)
		.map(([category, estimate]) => ({
			category,
			...scale(estimate),
			tools:
				category === "toolOutputs"
					? context.toolOutputs
							.filter((tool) => tool.tokens > 0)
							.map((tool) => ({ toolName: tool.toolName, ...scale(tool.tokens) }))
					: [],
		}))
		.toSorted((left, right) => right.share - left.share);
}

const categoryPresentation: Readonly<
	Record<SessionContextCategory, { readonly label: MessageDescriptor; readonly color: string }>
> = {
	toolOutputs: { label: desktopMessages.sessionContextToolOutputs, color: "bg-rose-400" },
	thinking: { label: desktopMessages.sessionContextThinking, color: "bg-amber-400" },
	systemPrompt: { label: desktopMessages.sessionContextSystemPrompt, color: "bg-slate-400" },
	toolDefinitions: { label: desktopMessages.sessionContextToolDefinitions, color: "bg-violet-400" },
	toolInputs: { label: desktopMessages.sessionContextToolInputs, color: "bg-cyan-400" },
	userMessages: { label: desktopMessages.sessionContextUserMessages, color: "bg-emerald-400" },
	assistantText: { label: desktopMessages.sessionContextAssistantText, color: "bg-sky-400" },
};

export function SessionUsageButton({
	usage = EMPTY_DESKTOP_SESSION_USAGE,
	context,
	contextWindow: modelContextWindow,
	autoCompaction,
	onAutoCompactionChange,
	onCompact,
	compactDisabled = false,
}: {
	readonly usage?: DesktopSessionUsage;
	/** Absent until the Runtime Host measures a request on the current branch. */
	readonly context?: DesktopSessionContext;
	/** The selected model's window, used until a measurement names its own. */
	readonly contextWindow?: number;
	/** Absent while the agent settings are still loading. */
	readonly autoCompaction?: boolean;
	readonly onAutoCompactionChange?: (enabled: boolean) => void;
	/** Absent when there is no Session to compact. */
	readonly onCompact?: () => Promise<DesktopFailure | undefined>;
	readonly compactDisabled?: boolean;
}) {
	const intl = useIntl();
	const icons = useIcons();
	const [open, setOpen] = useState(false);
	const [breakdownOpen, setBreakdownOpen] = useState(false);
	const [compacting, setCompacting] = useState(false);
	const usedTokens = context?.usedTokens ?? usage.contextTokens;
	const contextWindow = context?.contextWindow ?? modelContextWindow;
	const ratio = resolveContextRatio(usedTokens, contextWindow);
	const compactAtTokens = autoCompaction === false ? undefined : context?.compactAtTokens;
	const compactAtRatio =
		compactAtTokens === undefined ? undefined : resolveContextRatio(compactAtTokens, contextWindow);
	const breakdown = context ? resolveContextBreakdown(context) : [];
	const compactNumber = (value: number) => intl.formatNumber(value, { notation: "compact", maximumFractionDigits: 1 });
	const percent = (share: number) =>
		intl.formatNumber(share, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
	const usedLabel = contextWindow
		? `${compactNumber(usedTokens)} / ${compactNumber(contextWindow)}`
		: compactNumber(usedTokens);
	const triggerLabel = contextWindow ? `${usedLabel} · ${Math.round(ratio * 100)}%` : usedLabel;
	const barLabel = contextWindow
		? intl.formatMessage(desktopMessages.sessionContextBarLabel, {
				used: compactNumber(usedTokens),
				window: compactNumber(contextWindow),
			})
		: usedLabel;
	const cacheTokens = usage.cacheReadTokens + usage.cacheWriteTokens;
	const ChevronIcon = icons["chevron-down"];
	const CheckIcon = icons.check;

	const compact = async () => {
		if (!onCompact || compacting) return;
		setCompacting(true);
		try {
			const failure = await onCompact();
			if (failure) notifyFailure(failure, intl, { dedupeKey: "session-compact" });
		} finally {
			setCompacting(false);
		}
	};

	return (
		<Popover.Root open={open} onOpenChange={setOpen} modal={false}>
			<Popover.Trigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon"
						active={open}
						aria-label={intl.formatMessage(desktopMessages.sessionUsageAria)}
						title={`${intl.formatMessage(desktopMessages.sessionUsageContext)} ${triggerLabel}`}
						className={cn("rounded-full", ratio >= 0.9 ? "text-destructive" : "text-muted-foreground")}
					/>
				}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true" className="-rotate-90">
					<circle cx="8" cy="8" r={RING_RADIUS} fill="none" strokeWidth="2" className="stroke-foreground/12" />
					<circle
						cx="8"
						cy="8"
						r={RING_RADIUS}
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap={ratio > 0 ? "round" : "butt"}
						strokeDasharray={RING_CIRCUMFERENCE}
						strokeDashoffset={RING_CIRCUMFERENCE * (1 - ratio)}
						className="transition-[stroke-dashoffset] duration-300 ease-out"
					/>
				</svg>
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner side="top" align="end" sideOffset={8} className="z-50 outline-none">
					<Popover.Popup
						render={<Elevated offset={2} shadowLevel={5} />}
						className="flex w-[min(280px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg bg-popover p-1.5 text-[12.5px] outline-none transition-[opacity,transform] duration-150 ease-out data-starting-style:scale-[.96] data-starting-style:translate-y-[-2px] data-starting-style:opacity-0 data-ending-style:scale-[.96] data-ending-style:translate-y-[-2px] data-ending-style:opacity-0"
					>
						<div className="flex flex-col gap-2 px-1.5 pt-1.5 pb-2">
							<div className="text-[13px] font-medium text-foreground">
								{intl.formatMessage(desktopMessages.sessionContextTitle)}
							</div>
							<div
								role="img"
								aria-label={barLabel}
								className="relative h-1.5 w-full rounded-full bg-foreground/10"
							>
								<div
									className="flex h-full overflow-hidden rounded-full transition-[width] duration-300 ease-out"
									style={{ width: `${ratio * 100}%` }}
								>
									{breakdown.length > 0 ? (
										breakdown.map((row) => (
											<span
												key={row.category}
												className={cn("h-full", categoryPresentation[row.category].color)}
												style={{ width: `${row.share * 100}%` }}
											/>
										))
									) : (
										<span className="h-full w-full bg-foreground/35" />
									)}
								</div>
								{compactAtRatio !== undefined ? (
									<span
										aria-hidden="true"
										className="absolute -top-1 -bottom-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground"
										style={{ left: `${compactAtRatio * 100}%` }}
									/>
								) : null}
							</div>
							<div className="flex items-center justify-between gap-3 tabular-nums">
								<span className="font-medium text-foreground">{usedLabel}</span>
								{compactAtTokens !== undefined ? (
									<span className="text-muted-foreground">
										{intl.formatMessage(desktopMessages.sessionContextCompactAt, {
											tokens: compactNumber(compactAtTokens),
										})}
									</span>
								) : null}
							</div>
							{breakdown.length === 0 ? (
								<p className="leading-5 text-muted-foreground">
									{intl.formatMessage(desktopMessages.sessionContextPending)}
								</p>
							) : null}
						</div>
						{/* No height animation: the popup opens upward, so an animated height would reposition it every frame. */}
						{breakdown.length > 0 ? (
							<>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									aria-expanded={breakdownOpen}
									trailingIcon={ChevronIcon}
									onClick={() => setBreakdownOpen((current) => !current)}
									className={cn("w-full justify-start px-1.5 text-[12.5px] font-normal", {
										"[&_svg]:rotate-180": breakdownOpen,
									})}
								>
									{intl.formatMessage(
										breakdownOpen
											? desktopMessages.sessionContextHideBreakdown
											: desktopMessages.sessionContextShowBreakdown,
									)}
								</Button>
								{breakdownOpen ? (
									<ul className="flex max-h-60 flex-col gap-1.5 overflow-y-auto px-1.5 py-1.5">
										{breakdown.map((row) => (
											<li key={row.category} className="flex flex-col gap-1.5">
												<BreakdownRow
													label={intl.formatMessage(categoryPresentation[row.category].label)}
													color={categoryPresentation[row.category].color}
													tokens={compactNumber(row.tokens)}
													share={percent(row.share)}
												/>
												{row.tools.length > 0 ? (
													<ul className="flex flex-col gap-1.5 pl-3">
														{row.tools.map((tool) => (
															<li key={tool.toolName}>
																<BreakdownRow
																	label={tool.toolName}
																	color={categoryPresentation[row.category].color}
																	tokens={compactNumber(tool.tokens)}
																	share={percent(tool.share)}
																/>
															</li>
														))}
													</ul>
												) : null}
											</li>
										))}
									</ul>
								) : null}
							</>
						) : null}
						<div className="mx-1.5 my-1 border-t border-border" />
						<div className="flex flex-col gap-1.5 px-1.5 py-1.5">
							<div className="font-medium text-foreground">
								{intl.formatMessage(desktopMessages.sessionUsageTitle)}
							</div>
							{isEmptySessionUsage(usage) ? (
								<p className="leading-5 text-muted-foreground">
									{intl.formatMessage(desktopMessages.sessionUsageEmpty)}
								</p>
							) : (
								<ul className="flex flex-col gap-1.5">
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
								</ul>
							)}
						</div>
						<div className="mx-1.5 my-1 border-t border-border" />
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={!onCompact || compactDisabled || compacting}
							onClick={() => void compact()}
							className="w-full justify-start px-1.5 text-[12.5px] font-normal text-foreground"
						>
							{intl.formatMessage(
								compacting
									? desktopMessages.sessionContextCompacting
									: desktopMessages.sessionContextCompactNow,
							)}
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							role="switch"
							aria-checked={autoCompaction === true}
							disabled={autoCompaction === undefined || !onAutoCompactionChange}
							onClick={() => {
								if (autoCompaction !== undefined) onAutoCompactionChange?.(!autoCompaction);
							}}
							contentClassName="w-full"
							labelClassName="flex w-full items-center justify-between gap-3"
							className="w-full px-1.5 text-[12.5px] font-normal text-foreground"
						>
							{intl.formatMessage(desktopMessages.sessionContextAutoCompaction)}
							<CheckIcon
								size={14}
								aria-hidden="true"
								className={cn("shrink-0 text-brand", { invisible: autoCompaction !== true })}
							/>
						</Button>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

function BreakdownRow({
	label,
	color,
	tokens,
	share,
}: {
	readonly label: string;
	readonly color: string;
	readonly tokens: string;
	readonly share: string;
}) {
	return (
		<div className="flex items-center gap-2">
			<span aria-hidden="true" className={cn("h-3 w-1 shrink-0 rounded-full", color)} />
			<span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
			<span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">{tokens}</span>
			<span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{share}</span>
		</div>
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
