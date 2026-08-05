import { useState } from "react";
import { resolveProviderBrandIcon, useIcon } from "@/lib/icon-context";
import {
	type DesktopProviderFetchModelsResult,
	type DesktopProviderModel,
	isDesktopProviderModelRunnable,
} from "../../../../shared/desktop-rpc";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { CheckboxGroup, CheckboxItem } from "../../ui/checkbox-group";
import { Input } from "../../ui/input";
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
	const RefreshIcon = useIcon("rotate-ccw");
	const SearchIcon = useIcon("search");
	const [query, setQuery] = useState("");
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const matchingModels = normalizedQuery
		? profile.models.filter(
				(model) =>
					model.name.toLocaleLowerCase().includes(normalizedQuery) ||
					model.remoteModelId.toLocaleLowerCase().includes(normalizedQuery),
			)
		: profile.models;
	const visibleModels = matchingModels.slice(0, MAX_VISIBLE_MODELS);
	const checkedIndices = new Set(visibleModels.flatMap((model, index) => (model.enabled ? [index] : [])));

	return (
		<section className="flex flex-col gap-3 pt-2">
			<div className="flex items-center justify-between gap-3">
				<h3 className="text-[14px] font-semibold">Models</h3>
				<Button
					type="button"
					variant="tertiary"
					size="sm"
					leadingIcon={RefreshIcon}
					loading={fetching}
					disabled={fetching}
					onClick={() => void onFetchModels(profile.id)}
				>
					Fetch models
				</Button>
			</div>
			{lastFetch ? <p className="text-[12px] text-muted-foreground">{lastFetch.modelCount} models fetched</p> : null}
			{profile.models.length === 0 ? (
				<div className="flex min-h-28 items-center justify-center rounded-xl bg-muted/35 px-4 text-[13px] text-muted-foreground">
					No models fetched
				</div>
			) : (
				<div className="flex flex-col gap-2">
					<div className="relative">
						<SearchIcon
							size={14}
							className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							density="compact"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={`Search ${profile.models.length} models`}
							aria-label="Search models"
							className="pl-8"
						/>
					</div>
					{matchingModels.length === 0 ? (
						<div className="flex min-h-20 items-center justify-center rounded-xl bg-muted/35 px-4 text-[12px] text-muted-foreground">
							No matching models
						</div>
					) : (
						<>
							<CheckboxGroup
								checkedIndices={checkedIndices}
								className="max-h-80 w-full divide-y divide-border/45 overflow-y-auto rounded-lg border border-border/45 bg-transparent py-0.5"
								aria-label={`${profile.name} models`}
							>
								{visibleModels.map((model, index) => {
									const availability = modelAvailability(model);
									return (
										<CheckboxItem
											key={model.id}
											index={index}
											checked={model.enabled}
											label={`Enable ${model.name}`}
											disabled={!availability.selectable && !model.enabled}
											onToggle={() =>
												onModelsChange(
													profile.models.map((candidate) =>
														candidate.id === model.id
															? { ...candidate, enabled: !candidate.enabled }
															: candidate,
													),
												)
											}
											className="h-auto min-h-13 items-start rounded-md px-2.5 py-2 data-[disabled=true]:cursor-not-allowed"
										>
											<ModelCard model={model} availability={availability} />
										</CheckboxItem>
									);
								})}
							</CheckboxGroup>
							{matchingModels.length > visibleModels.length ? (
								<p className="text-[11px] text-muted-foreground">
									Showing {visibleModels.length} of {matchingModels.length}. Search to find other models.
								</p>
							) : null}
						</>
					)}
				</div>
			)}
		</section>
	);
}

function ModelCard({
	model,
	availability,
}: {
	readonly model: DesktopProviderModel;
	readonly availability: ModelAvailability;
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
						title={`Input: ${formatModalities(model.inputModalities)} → Output: ${formatModalities(model.outputModalities)}`}
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
						title={`Context: ${formatLimit(model.contextWindow)} · Input: ${formatLimit(model.inputLimit)} · Output: ${formatLimit(model.maxTokens)}`}
					>
						<span>
							<span className="text-muted-foreground/80">{formatCompactLimit(model.contextWindow)} context</span>
						</span>
						<span className="text-muted-foreground/50">·</span>
						<span>
							<span className="text-muted-foreground/80">{formatCompactLimit(model.inputLimit)} input</span>
						</span>
						<span className="text-muted-foreground/50">·</span>
						<span>
							<span className="text-muted-foreground/80">{formatCompactLimit(model.maxTokens)} output</span>
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

function modelAvailability(model: DesktopProviderModel): ModelAvailability {
	if (!model.verified) return { label: "Unverified", selectable: false, verified: false };
	if (!model.inputModalities?.includes("text") || !model.outputModalities?.includes("text")) {
		return { label: "Text unsupported", selectable: false, verified: true };
	}
	if (model.toolCall !== true) return { label: "Tools unsupported", selectable: false, verified: true };
	if (!isDesktopProviderModelRunnable(model))
		return { label: "Limits unavailable", selectable: false, verified: true };
	return { label: "Ready", selectable: true, verified: true };
}

function formatModalities(value: readonly string[] | undefined): string {
	return value?.join(", ") || "—";
}

function formatLimit(value: number | undefined): string {
	return value === undefined ? "—" : value.toLocaleString();
}

function formatCompactLimit(value: number | undefined): string {
	return value === undefined
		? "—"
		: new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}
