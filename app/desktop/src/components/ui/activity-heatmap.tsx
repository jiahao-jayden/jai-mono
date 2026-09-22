import { useMemo } from "react";
import { cn } from "cn";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import type { DesktopProfileTokenStats } from "../../../shared/desktop-rpc";
import { Tooltip } from "./tooltip";

type HeatmapLevel = 0 | 1 | 2 | 3 | 4;
type HeatmapCell = { readonly date: string; readonly tokens: number; readonly level: HeatmapLevel };
type HeatmapSlot = { readonly kind: "cell"; readonly cell: HeatmapCell } | { readonly kind: "pad"; readonly id: string };

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const INTENSITY_CLASSES = [
	"bg-muted/70 dark:bg-white/[0.06]",
	"bg-[color-mix(in_srgb,var(--brand)_18%,transparent)]",
	"bg-[color-mix(in_srgb,var(--brand)_32%,transparent)]",
	"bg-[color-mix(in_srgb,var(--brand)_48%,transparent)]",
	"bg-[color-mix(in_srgb,var(--brand)_66%,transparent)]",
];

export function ActivityHeatmap({
	days,
	empty,
	weeks = 52,
}: {
	readonly days: DesktopProfileTokenStats["days"];
	readonly empty: boolean;
	readonly weeks?: number;
}) {
	const intl = useIntl();
	const cells = useMemo(() => createHeatmapCells(days, empty, weeks), [days, empty, weeks]);
	const columns = useMemo(() => createColumns(cells), [cells]);
	const monthLabels = useMemo(() => createMonthLabels(columns), [columns]);

	return (
		<div
			className="flex w-full min-w-0 flex-col gap-3"
			role="img"
			aria-label={intl.formatMessage(desktopMessages.settingsProfileHeatmapAria)}
		>
			<div className="flex w-full min-w-0 flex-col gap-2">
				<div className="flex w-full min-w-0 gap-[3px]">
					{monthLabels.map((label, index) => (
						<div key={`${label ?? "empty"}-${index}`} className="min-w-0 flex-1 text-[11px] leading-none text-muted-foreground">
							{label}
						</div>
					))}
				</div>
				<div className="flex w-full min-w-0 gap-[3px]">
					{columns.map((column) => (
						<div key={column.key} className="flex min-w-0 flex-1 flex-col gap-[3px]">
							{column.slots.map((slot) => {
								if (slot.kind === "pad") {
									return <div key={slot.id} className="aspect-square w-full bg-transparent" />;
								}
								const label = intl.formatMessage(desktopMessages.settingsProfileHeatmapTooltip, {
									date: slot.cell.date,
									tokens: formatTokenCount(slot.cell.tokens),
								});
								return (
									<Tooltip key={slot.cell.date} content={label} delayDuration={0}>
										<div
											className={cn("aspect-square w-full min-w-0 rounded-[4px]", INTENSITY_CLASSES[slot.cell.level])}
											title={label}
										/>
									</Tooltip>
								);
							})}
						</div>
					))}
				</div>
			</div>
			<p className="text-[11px] text-muted-foreground">
				{intl.formatMessage(desktopMessages.settingsProfileHeatmapLegend)}
			</p>
		</div>
	);
}

function createHeatmapCells(
	days: DesktopProfileTokenStats["days"],
	empty: boolean,
	weeks: number,
): readonly HeatmapCell[] {
	const byDate = new Map(days.map((day) => [day.date, day.totalTokens]));
	const maxTokens = days.reduce((max, day) => Math.max(max, day.totalTokens), 0);
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const end = new Date(today);
	end.setDate(end.getDate() + (6 - end.getDay()));
	const start = new Date(end);
	start.setDate(start.getDate() - (weeks * 7 - 1));

	return Array.from({ length: weeks * 7 }, (_, index) => {
		const date = new Date(start);
		date.setDate(start.getDate() + index);
		const dateKey = localDateKey(date);
		const tokens = byDate.get(dateKey) ?? 0;
		return { date: dateKey, tokens, level: empty ? 0 : tokenLevel(tokens, maxTokens) };
	});
}

function createColumns(cells: readonly HeatmapCell[]): readonly { readonly key: string; readonly slots: readonly HeatmapSlot[] }[] {
	if (cells.length === 0) return [];
	const slots: HeatmapSlot[] = [];
	const firstWeekday = new Date(`${cells[0].date}T00:00:00`).getDay();
	for (let index = 0; index < firstWeekday; index += 1) slots.push({ kind: "pad", id: `lead-${index}` });
	for (const cell of cells) slots.push({ kind: "cell", cell });
	while (slots.length % 7 !== 0) slots.push({ kind: "pad", id: `tail-${slots.length}` });
	return Array.from({ length: slots.length / 7 }, (_, index) => {
		const weekSlots = slots.slice(index * 7, index * 7 + 7);
		const firstCell = weekSlots.find((slot): slot is Extract<HeatmapSlot, { kind: "cell" }> => slot.kind === "cell");
		return { key: firstCell?.cell.date ?? `column-${index}`, slots: weekSlots };
	});
}

function createMonthLabels(columns: readonly { readonly slots: readonly HeatmapSlot[] }[]): readonly (string | null)[] {
	let previousMonth = -1;
	return columns.map((column) => {
		const cell = column.slots.find((slot): slot is Extract<HeatmapSlot, { kind: "cell" }> => slot.kind === "cell");
		if (!cell) return null;
		const month = Number(cell.cell.date.slice(5, 7)) - 1;
		if (month === previousMonth) return null;
		previousMonth = month;
		return MONTH_NAMES[month] ?? null;
	});
}

function localDateKey(date: Date): string {
	return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function formatTokenCount(tokens: number): string {
	return tokens.toLocaleString();
}

function tokenLevel(tokens: number, maxTokens: number): HeatmapLevel {
	if (tokens <= 0 || maxTokens <= 0) return 0;
	const ratio = Math.log1p(tokens) / Math.log1p(maxTokens);
	if (ratio <= 0.25) return 1;
	if (ratio <= 0.5) return 2;
	if (ratio <= 0.75) return 3;
	return 4;
}
