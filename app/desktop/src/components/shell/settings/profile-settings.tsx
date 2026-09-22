import { useQuery } from "@tanstack/react-query";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { desktop } from "@/lib/desktop";
import { desktopQueryKeys } from "@/lib/desktop-query";
import { useIcon } from "@/lib/icon-context";
import type { DesktopProfileTokenStats } from "../../../../shared/desktop-rpc";
import { EMPTY_DESKTOP_PROFILE_TOKEN_STATS } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { formatSessionTokens } from "../chat/session-usage";
import { ActivityHeatmap } from "../../ui/activity-heatmap";

export function ProfileSettings() {
	const intl = useIntl();
	const AnalyticsIcon = useIcon("analytics");
	const query = useQuery({
		queryKey: desktopQueryKeys.profileTokenStats,
		queryFn: () => desktop.profile.getTokenStats(),
	});

	if (query.isLoading || query.isFetching) {
		return (
			<div className="flex flex-col items-center justify-center gap-2 px-8 py-16 text-center">
				<AnalyticsIcon className="size-5 text-muted-foreground" />
				<p className="text-[13px] text-muted-foreground">
					{intl.formatMessage(desktopMessages.settingsProfileLoading)}
				</p>
			</div>
		);
	}

	if (query.isError) {
		return (
			<div className="flex flex-col items-center justify-center gap-3 px-8 py-16 text-center">
				<p className="text-[14px] font-medium" role="alert">
					{intl.formatMessage(desktopMessages.settingsProfileLoadError)}
				</p>
				<Button type="button" variant="tertiary" onClick={() => void query.refetch()}>
					{intl.formatMessage(desktopMessages.settingsRetry)}
				</Button>
			</div>
		);
	}

	const stats = query.data ?? EMPTY_DESKTOP_PROFILE_TOKEN_STATS;
	return <ProfileTokenDashboard stats={stats} onRetry={() => void query.refetch()} />;
}

export function ProfileTokenDashboard({
	stats,
	onRetry,
}: {
	readonly stats: DesktopProfileTokenStats;
	readonly onRetry?: () => void;
}) {
	const intl = useIntl();
	const tokensUnavailable = stats.availability === "empty";

	return (
		<div className="flex flex-col gap-8 px-8 py-6">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<h2 className="text-[14px] font-medium">{intl.formatMessage(desktopMessages.settingsProfileUsage)}</h2>
					<p className="mt-1 max-w-xl text-[12px] leading-relaxed text-muted-foreground">
						{intl.formatMessage(desktopMessages.settingsProfileUsageDescription)}
					</p>
				</div>
				{onRetry ? (
					<Button type="button" variant="ghost" size="chip" onClick={onRetry}>
						{intl.formatMessage(desktopMessages.settingsProfileRefresh)}
					</Button>
				) : null}
			</div>

			<div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
				<StatCard
					label={intl.formatMessage(desktopMessages.settingsProfilePrompts)}
					value={formatSessionTokens(stats.promptCount)}
				/>
				<StatCard
					label={intl.formatMessage(desktopMessages.settingsProfileLifetimeTokens)}
					value={tokensUnavailable ? "—" : formatSessionTokens(stats.totalTokens)}
				/>
				<StatCard
					label={intl.formatMessage(desktopMessages.settingsProfilePeakDay)}
					value={
						tokensUnavailable || !stats.peakDayDate
							? "—"
							: intl.formatMessage(desktopMessages.settingsProfilePeakDayValue, {
									tokens: formatSessionTokens(stats.peakDayTokens),
									date: stats.peakDayDate,
								})
					}
				/>
				<StatCard
					label={intl.formatMessage(desktopMessages.settingsProfileSettledAttempts)}
					value={formatSessionTokens(stats.settledAttemptCount)}
				/>
			</div>

			{tokensUnavailable ? (
				<p className="rounded-lg bg-muted/60 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground" role="status">
					{stats.promptCount > 0
						? intl.formatMessage(desktopMessages.settingsProfileTokensUnavailableWithPrompts)
						: intl.formatMessage(desktopMessages.settingsProfileTokensEmpty)}
				</p>
			) : null}

		<section className="flex flex-col gap-3">
			<h3 className="text-[13px] font-medium">{intl.formatMessage(desktopMessages.settingsProfileHeatmap)}</h3>
			<ActivityHeatmap days={stats.days} empty={tokensUnavailable} />
		</section>

			<section className="flex flex-col gap-3">
				<h3 className="text-[13px] font-medium">{intl.formatMessage(desktopMessages.settingsProfileModels)}</h3>
				{tokensUnavailable || stats.models.length === 0 ? (
					<p className="text-[12px] text-muted-foreground">
						{intl.formatMessage(desktopMessages.settingsProfileModelsEmpty)}
					</p>
				) : (
					<ul className="flex flex-col gap-2">
						{stats.models.map((model) => {
							const share = stats.totalTokens === 0 ? 0 : model.totalTokens / stats.totalTokens;
							const barWidth = `${Math.max(share * 100, model.totalTokens > 0 ? 2 : 0)}%`;
							return (
								<li key={`${model.provider}/${model.modelId}`} className="flex flex-col gap-1">
									<div className="flex items-baseline justify-between gap-3 text-[12px]">
										<span className="min-w-0 truncate font-medium">
											{model.provider}
											<span className="font-normal text-muted-foreground"> / {model.modelId}</span>
										</span>
										<span className="shrink-0 tabular-nums text-muted-foreground">
											{intl.formatMessage(desktopMessages.settingsProfileTokensUnit, {
												tokens: formatSessionTokens(model.totalTokens),
											})}
										</span>
									</div>
									<div className="h-1.5 overflow-hidden rounded-full bg-muted">
										<div className="h-full rounded-full bg-foreground/70" style={{ width: barWidth }} />
									</div>
								</li>
							);
						})}
					</ul>
				)}
			</section>
		</div>
	);
}

function StatCard({ label, value }: { readonly label: string; readonly value: string }) {
	return (
		<div className="rounded-lg border border-border/70 px-3 py-2.5">
			<div className="text-[11px] text-muted-foreground">{label}</div>
			<div className="mt-1 truncate text-[16px] font-medium tabular-nums tracking-tight">{value}</div>
		</div>
	);
}
