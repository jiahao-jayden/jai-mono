import { useState } from "react";
import { type IntlShape, useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { resolveProviderBrandIcon, useIcon } from "@/lib/icon-context";
import {
	type DesktopProviderFetchModelsResult,
	type DesktopProviderModel,
	isDesktopProviderModelRunnable,
} from "../../../../shared/desktop-rpc";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/collapsible";
import { Input } from "../../ui/input";
import { Switch } from "../../ui/switch";
import { Tooltip, TooltipProvider } from "../../ui/tooltip";
import { ModelCapabilities } from "../model-capabilities";
import type { ProfileDraft } from "./provider-settings-types";

const MAX_VISIBLE_MODELS = 100;

interface ProviderModelEditorProps {
	readonly profile: ProfileDraft;
	readonly onModelsChange: (models: DesktopProviderModel[]) => void;
	readonly onFetchModels: (profileId: string) => Promise<void>;
	readonly fetching: boolean;
	readonly lastFetch?: DesktopProviderFetchModelsResult;
}

export function ProviderModelEditor({
	profile,
	onModelsChange,
	onFetchModels,
	fetching,
	lastFetch,
}: ProviderModelEditorProps) {
	const intl = useIntl();
	const RefreshIcon = useIcon("rotate-ccw");
	const SearchIcon = useIcon("search");
	const ChevronIcon = useIcon("chevron-right");
	const [query, setQuery] = useState("");
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const enabledModels = profile.models.filter((model) => model.enabled);
	const candidates = profile.models.filter((model) => !model.enabled);
	const matchingModels = normalizedQuery
		? candidates.filter(
				(model) =>
					model.name.toLocaleLowerCase().includes(normalizedQuery) ||
					model.remoteModelId.toLocaleLowerCase().includes(normalizedQuery),
			)
		: candidates;
	// Unverified models are folded away only while browsing; a search shows everything it hits.
	const verifiedModels = normalizedQuery ? matchingModels : matchingModels.filter((model) => model.verified);
	const unverifiedModels = normalizedQuery ? [] : matchingModels.filter((model) => !model.verified);
	const visibleModels = verifiedModels.slice(0, MAX_VISIBLE_MODELS);
	const toggleModel = (id: string) =>
		onModelsChange(
			profile.models.map((candidate) =>
				candidate.id === id ? { ...candidate, enabled: !candidate.enabled } : candidate,
			),
		);
	const renderRow = (model: DesktopProviderModel) => {
		const availability = modelAvailability(model, intl);
		return (
			<ModelRow
				key={model.id}
				model={model}
				availability={availability}
				intl={intl}
				onToggle={() => toggleModel(model.id)}
			/>
		);
	};

	return (
		<section className="flex flex-col gap-3 pt-2">
			<div className="flex items-center justify-between gap-3">
				<h3 className="text-[14px] font-semibold">{intl.formatMessage(desktopMessages.settingsModels)}</h3>
				<Button
					type="button"
					variant="tertiary"
					size="sm"
					leadingIcon={RefreshIcon}
					loading={fetching}
					disabled={fetching}
					onClick={() => void onFetchModels(profile.id)}
				>
					{intl.formatMessage(desktopMessages.settingsFetchModels)}
				</Button>
			</div>
			{lastFetch ? (
				<p className="text-[12px] text-muted-foreground">
					{intl.formatMessage(desktopMessages.settingsModelsFetched, { count: lastFetch.modelCount })}
				</p>
			) : null}
			{profile.models.length === 0 ? (
				<div className="flex min-h-28 items-center justify-center rounded-xl bg-muted/35 px-4 text-[13px] text-muted-foreground">
					{intl.formatMessage(desktopMessages.settingsNoModelsFetched)}
				</div>
			) : (
				<div className="flex flex-col gap-5">
					<div className="flex flex-col gap-2">
						<h4 className="text-[12px] font-medium text-muted-foreground">
							{intl.formatMessage(desktopMessages.settingsModelsEnabled, { count: enabledModels.length })}
						</h4>
						{enabledModels.length === 0 ? (
							<div className="flex min-h-16 items-center justify-center rounded-xl bg-muted/35 px-4 text-[12px] text-muted-foreground">
								{intl.formatMessage(desktopMessages.settingsModelsNoneEnabled)}
							</div>
						) : (
							<div className="divide-y divide-border rounded-xl shadow-surface-1">
								{enabledModels.map(renderRow)}
							</div>
						)}
					</div>

					<div className="flex flex-col gap-2">
						<h4 className="text-[12px] font-medium text-muted-foreground">
							{intl.formatMessage(desktopMessages.settingsModelsAvailable, { count: candidates.length })}
						</h4>
						<div className="relative">
							<SearchIcon
								size={14}
								className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								density="compact"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder={intl.formatMessage(desktopMessages.settingsModelsSearch, {
									count: candidates.length,
								})}
								aria-label={intl.formatMessage(desktopMessages.settingsModelsAvailable, {
									count: candidates.length,
								})}
								className="pl-8"
							/>
						</div>
						{matchingModels.length === 0 ? (
							<div className="flex min-h-16 items-center justify-center rounded-xl bg-muted/35 px-4 text-[12px] text-muted-foreground">
								{intl.formatMessage(desktopMessages.modelNoMatch)}
							</div>
						) : (
							<div className="max-h-80 overflow-y-auto rounded-xl shadow-surface-1">
								<div className="divide-y divide-border">{visibleModels.map(renderRow)}</div>
								{verifiedModels.length > visibleModels.length ? (
									<p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
										{intl.formatMessage(desktopMessages.settingsModelsSearchHelp, {
											visible: visibleModels.length,
											total: verifiedModels.length,
										})}
									</p>
								) : null}
								{unverifiedModels.length > 0 ? (
									<Collapsible>
										<CollapsibleTrigger
											render={
												<Button
													type="button"
													variant="ghost"
													size="sm"
													leadingIcon={ChevronIcon}
													className="w-full justify-start rounded-none border-t border-border px-3 text-[12px] text-muted-foreground [&_svg]:transition-transform data-[panel-open]:[&_svg]:rotate-90"
												/>
											}
										>
											{intl.formatMessage(desktopMessages.settingsModelsUnverifiedGroup, {
												count: unverifiedModels.length,
											})}
										</CollapsibleTrigger>
										<CollapsibleContent className="divide-y divide-border border-t border-border">
											{unverifiedModels.slice(0, MAX_VISIBLE_MODELS).map(renderRow)}
										</CollapsibleContent>
									</Collapsible>
								) : null}
							</div>
						)}
					</div>
				</div>
			)}
		</section>
	);
}

function ModelRow({
	model,
	availability,
	intl,
	onToggle,
}: {
	readonly model: DesktopProviderModel;
	readonly availability: ModelAvailability;
	readonly intl: IntlShape;
	readonly onToggle: () => void;
}) {
	return (
		<div className="flex items-center gap-4 px-3 py-2.5">
			<ModelCard model={model} availability={availability} intl={intl} />
			<Switch
				label={intl.formatMessage(desktopMessages.settingsEnableModel, { name: model.name })}
				hideLabel
				checked={model.enabled}
				disabled={!availability.selectable && !model.enabled}
				onToggle={onToggle}
			/>
		</div>
	);
}

function ModelCard({
	model,
	availability,
	intl,
}: {
	readonly model: DesktopProviderModel;
	readonly availability: ModelAvailability;
	readonly intl: IntlShape;
}) {
	const ArrowIcon = useIcon("arrow-right");
	const BrandIcon = resolveProviderBrandIcon(model.metadataProvider, model.remoteModelId);
	return (
		<TooltipProvider delayDuration={250}>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex min-w-0 items-center gap-2">
					{BrandIcon ? <BrandIcon size={17} className="shrink-0 text-muted-foreground/75" /> : null}
					<div className="min-w-0 flex-1">
						<Tooltip content={model.remoteModelId} side="top" sideOffset={6}>
							<span className="block w-fit max-w-full truncate text-[13px] font-medium text-foreground">
								{model.name}
							</span>
						</Tooltip>
					</div>
					<ModelCapabilities model={model} />
					{availability.selectable ? null : (
						<Badge color={availability.verified ? "amber" : "orange"} size="sm">
							{availability.label}
						</Badge>
					)}
				</div>
				<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
					<div
						className="flex min-w-0 items-center gap-1.5"
						title={intl.formatMessage(desktopMessages.settingsModelInputOutput, {
							input: formatModalities(model.inputModalities),
							output: formatModalities(model.outputModalities),
						})}
					>
						<span className="truncate text-muted-foreground/80">{formatModalities(model.inputModalities)}</span>
						<ArrowIcon size={11} className="shrink-0 text-muted-foreground" />
						<span className="truncate text-muted-foreground/80">{formatModalities(model.outputModalities)}</span>
					</div>
					<span className="text-muted-foreground/45" aria-hidden="true">
						·
					</span>
					<div
						className="flex items-center gap-1.5"
						title={intl.formatMessage(desktopMessages.settingsModelLimits, {
							context: formatLimit(model.contextWindow, intl),
							input: formatLimit(model.inputLimit, intl),
							output: formatLimit(model.maxTokens, intl),
						})}
					>
						<span>
							<span className="text-muted-foreground/80">
								{intl.formatMessage(desktopMessages.settingsModelContext, {
									value: formatCompactLimit(model.contextWindow, intl),
								})}
							</span>
						</span>
						<span className="text-muted-foreground/50">·</span>
						<span>
							<span className="text-muted-foreground/80">
								{intl.formatMessage(desktopMessages.settingsModelInput, {
									value: formatCompactLimit(model.inputLimit, intl),
								})}
							</span>
						</span>
						<span className="text-muted-foreground/50">·</span>
						<span>
							<span className="text-muted-foreground/80">
								{intl.formatMessage(desktopMessages.settingsModelOutput, {
									value: formatCompactLimit(model.maxTokens, intl),
								})}
							</span>
						</span>
					</div>
				</div>
			</div>
		</TooltipProvider>
	);
}

interface ModelAvailability {
	readonly label: string;
	readonly selectable: boolean;
	readonly verified: boolean;
}

function modelAvailability(model: DesktopProviderModel, intl: IntlShape): ModelAvailability {
	if (!model.verified)
		return { label: intl.formatMessage(desktopMessages.settingsUnverified), selectable: false, verified: false };
	if (!model.inputModalities?.includes("text") || !model.outputModalities?.includes("text")) {
		return { label: intl.formatMessage(desktopMessages.settingsTextUnsupported), selectable: false, verified: true };
	}
	if (model.toolCall !== true)
		return { label: intl.formatMessage(desktopMessages.settingsToolsUnsupported), selectable: false, verified: true };
	if (!isDesktopProviderModelRunnable(model))
		return {
			label: intl.formatMessage(desktopMessages.settingsLimitsUnavailable),
			selectable: false,
			verified: true,
		};
	return { label: intl.formatMessage(desktopMessages.settingsReady), selectable: true, verified: true };
}

function formatModalities(value: readonly string[] | undefined): string {
	return value?.join(", ") || "—";
}

function formatLimit(value: number | undefined, intl: IntlShape): string {
	return value === undefined ? "—" : intl.formatNumber(value);
}

function formatCompactLimit(value: number | undefined, intl: IntlShape): string {
	return value === undefined ? "—" : intl.formatNumber(value, { notation: "compact", maximumFractionDigits: 2 });
}
