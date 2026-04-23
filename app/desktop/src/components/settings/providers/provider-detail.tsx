import {
	Delete02Icon,
	LinkSquare02Icon,
	Loading03Icon,
	Refresh01Icon,
	Search01Icon,
	ViewIcon,
	ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ConfigResponse, FetchModelsResponse, ProviderModel, ProviderSettings } from "@jayden/jai-gateway";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { CapabilityBadges } from "@/components/common/capability-badges";
import { BrandAvatar, resolveProviderIcon } from "@/components/common/provider-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";
import type { ModelCapabilities } from "@/stores/chat";
import { SettingsField, SettingsGroup } from "../common/settings-layout";
import { API_FORMAT_OPTIONS, BUILTIN_IDS, getBuiltinProvider, type ProviderFormat } from "./provider-registry";

function toUiCapabilities(model: ProviderModel): ModelCapabilities | undefined {
	const caps = model.capabilities;
	if (!caps) return undefined;
	return {
		reasoning: caps.reasoning,
		toolCall: caps.toolCall,
		structuredOutput: caps.structuredOutput,
		vision: caps.input?.image,
		imageGen: caps.output?.image,
		audio: caps.input?.audio,
		pdf: caps.input?.pdf,
	};
}

function formatContextLimit(limit?: { context: number; output: number }): string | null {
	if (!limit?.context) return null;
	const k = limit.context / 1000;
	return k >= 1000 ? `${(k / 1000).toFixed(0)}M` : `${k.toFixed(0)}K`;
}

function timeAgo(ts: number): string {
	const diff = Date.now() - ts;
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

interface ProviderDetailProps {
	providerId: string;
	config?: ConfigResponse;
}

export function ProviderDetail({ providerId, config }: ProviderDetailProps) {
	const builtin = getBuiltinProvider(providerId);
	const providerConfig = config?.providers?.[providerId];

	const queryClient = useQueryClient();
	const putMutation = useMutation({
		mutationFn: (cfg: ProviderSettings) => gateway.config.putProvider(providerId, cfg),
		onMutate: async (newCfg) => {
			await queryClient.cancelQueries({ queryKey: ["config"] });
			const prev = queryClient.getQueryData<ConfigResponse>(["config"]);
			if (prev) {
				queryClient.setQueryData<ConfigResponse>(["config"], {
					...prev,
					providers: { ...prev.providers, [providerId]: newCfg },
				});
			}
			return { prev };
		},
		onError: (_err, _newCfg, context) => {
			if (context?.prev) queryClient.setQueryData(["config"], context.prev);
		},
		onSettled: () => queryClient.invalidateQueries({ queryKey: ["config"] }),
	});
	const deleteMutation = useMutation({
		mutationFn: () => gateway.config.deleteProvider(providerId),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config"] }),
	});

	const [showKey, setShowKey] = useState(false);
	const [modelSearch, setModelSearch] = useState("");
	const [fetchedData, setFetchedData] = useState<FetchModelsResponse | null>(null);

	const defaults = builtin
		? { api_base: builtin.api_base, api_format: builtin.api_format }
		: { api_base: "", api_format: "openai-compatible" as ProviderFormat };

	const initialConfig: ProviderSettings = providerConfig ?? {
		enabled: true,
		api_base: defaults.api_base,
		api_format: defaults.api_format,
		models: [],
	};

	const [draftConfig, setDraftConfig] = useState<ProviderSettings>(initialConfig);

	const hasChanges = useMemo(
		() => JSON.stringify(draftConfig) !== JSON.stringify(initialConfig),
		[draftConfig, initialConfig],
	);

	const hasFetchConfigChanges =
		draftConfig.api_key !== initialConfig.api_key ||
		draftConfig.api_base !== initialConfig.api_base ||
		draftConfig.api_format !== initialConfig.api_format;

	const cachedModelsQuery = useQuery({
		queryKey: ["provider-models-cache", providerId],
		queryFn: () => gateway.config.fetchModels(providerId, false, true),
		enabled: !!providerConfig && !hasFetchConfigChanges,
	});

	const fetchModelsMutation = useMutation({
		mutationFn: (force: boolean) => gateway.config.fetchModels(providerId, force),
		onSuccess: (data) => {
			setFetchedData(data);
		},
		onError: (err) => {
			toast.error(err instanceof Error ? err.message : String(err));
		},
	});

	const enabledModelIds = useMemo(() => {
		const set = new Set<string>();
		for (const m of draftConfig.models) {
			set.add(m.id);
		}
		return set;
	}, [draftConfig.models]);

	const filteredFetchedModels = useMemo(() => {
		const models = fetchedData?.models ?? cachedModelsQuery.data?.models ?? [];
		if (!models.length) return [];
		if (!modelSearch.trim()) return models;
		const q = modelSearch.toLowerCase();
		return models.filter((m) => m.id.toLowerCase().includes(q));
	}, [cachedModelsQuery.data?.models, fetchedData?.models, modelSearch]);

	const resolvedFetchedData = fetchedData ?? (cachedModelsQuery.data?.models.length ? cachedModelsQuery.data : null);

	const handleToggle = useCallback((checked: boolean) => {
		setDraftConfig((prev) => ({ ...prev, enabled: checked }));
	}, []);

	const handleFormatChange = useCallback((value: string) => {
		setDraftConfig((prev) => ({ ...prev, api_format: value as ProviderFormat }));
	}, []);

	const handleModelToggle = useCallback(
		(modelId: string, enabled: boolean) => {
			if (enabled) {
				const fetched = (resolvedFetchedData?.models ?? []).find((m) => m.id === modelId);
				const entry: ProviderModel = fetched ?? { id: modelId };
				setDraftConfig((prev) => ({ ...prev, models: [...prev.models, entry] }));
				return;
			}

			setDraftConfig((prev) => ({
				...prev,
				models: prev.models.filter((m) => m.id !== modelId),
			}));
		},
		[resolvedFetchedData?.models],
	);

	const handleCancel = useCallback(() => {
		setDraftConfig(initialConfig);
	}, [initialConfig]);

	const handleSave = useCallback(() => {
		putMutation.mutate(draftConfig);
	}, [draftConfig, putMutation]);

	const triggerFetch = useCallback(
		async (force: boolean) => {
			if (!draftConfig.api_key) {
				toast.error("Please enter an API key first");
				return;
			}
			if (hasFetchConfigChanges) {
				await putMutation.mutateAsync(draftConfig);
			}
			fetchModelsMutation.mutate(force);
		},
		[draftConfig, hasFetchConfigChanges, putMutation, fetchModelsMutation],
	);

	const displayName = builtin?.name ?? providerId;
	const description = builtin?.description ?? "Custom provider";
	const resolvedIcon = resolveProviderIcon(providerId);

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
			<div className="flex-1 min-h-0 overflow-y-auto px-8 pt-6 pb-8 [scrollbar-gutter:stable]">
				<div className="mx-auto flex max-w-[640px] flex-col gap-7">
					<ProviderIdentity
						icon={resolvedIcon?.icon ?? null}
						name={displayName}
						description={description}
						enabled={draftConfig.enabled}
						onToggle={handleToggle}
						isCustom={!BUILTIN_IDS.has(providerId)}
						onDelete={() => deleteMutation.mutate()}
					/>

					<SettingsGroup title="Connection" bare>
						<SettingsField label="API Key">
							<div className="relative">
								<Input
									type={showKey ? "text" : "password"}
									value={draftConfig.api_key ?? ""}
									placeholder="sk-..."
									className="h-9 pr-10 font-mono text-[13px]"
									onChange={(e) =>
										setDraftConfig((prev) => ({
											...prev,
											api_key: e.target.value || undefined,
										}))
									}
								/>
								<button
									type="button"
									onClick={() => setShowKey((v) => !v)}
									className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/45 hover:text-foreground/80 transition-colors"
									aria-label={showKey ? "Hide API key" : "Show API key"}
								>
									<HugeiconsIcon icon={showKey ? ViewOffSlashIcon : ViewIcon} size={16} strokeWidth={1.75} />
								</button>
							</div>
							{builtin?.apiKeyUrl && (
								<a
									href={builtin.apiKeyUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="mt-1 inline-flex w-fit items-center gap-1 text-[11.5px] text-muted-foreground/55 underline decoration-muted-foreground/25 underline-offset-4 transition-colors hover:text-primary-2 hover:decoration-primary-2/60"
								>
									Get an API key from {displayName}
									<HugeiconsIcon icon={LinkSquare02Icon} size={12} strokeWidth={1.75} />
								</a>
							)}
						</SettingsField>

						<div className="border-t border-border/35" />

						<SettingsField
							label="Base URL"
							optional={!!builtin}
							hint={builtin ? `Leave empty to use the default ${displayName} endpoint.` : undefined}
						>
							<Input
								value={draftConfig.api_base}
								placeholder={defaults.api_base || "https://api.example.com/v1"}
								className="h-9 font-mono text-[13px]"
								onChange={(e) =>
									setDraftConfig((prev) => ({
										...prev,
										api_base: e.target.value,
									}))
								}
							/>
						</SettingsField>

						{!builtin && (
							<>
								<div className="border-t border-border/35" />
								<SettingsField label="API Format">
									<Select value={draftConfig.api_format} onValueChange={handleFormatChange}>
										<SelectTrigger className="w-full h-9">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{API_FORMAT_OPTIONS.map((opt) => (
												<SelectItem key={opt.value} value={opt.value}>
													{opt.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</SettingsField>
							</>
						)}
					</SettingsGroup>

					<SettingsGroup
						title="Models"
						bare
						action={
							<div className="flex items-center gap-3">
								{resolvedFetchedData && (
									<span
										className={cn(
											"font-serif italic text-[11.5px] tabular-nums",
											Date.now() - resolvedFetchedData.fetchedAt > 3600000
												? "text-amber-600/70"
												: "text-muted-foreground/55",
										)}
									>
										Synced {timeAgo(resolvedFetchedData.fetchedAt)}
									</span>
								)}
								<span className="text-[11.5px] text-muted-foreground/55 tabular-nums">
									{enabledModelIds.size} enabled
								</span>
							</div>
						}
					>
						<div className="flex items-center gap-2 px-4 py-3 border-b border-border/35" style={noDrag}>
							<div className="relative flex-1">
								<HugeiconsIcon
									icon={Search01Icon}
									size={14}
									strokeWidth={2}
									className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/45"
								/>
								<Input
									value={modelSearch}
									onChange={(e) => setModelSearch(e.target.value)}
									placeholder="Search models…"
									className="h-8 pl-8 text-[13px]"
								/>
							</div>
							<Button
								variant="outline"
								size="sm"
								onClick={() => triggerFetch(!!resolvedFetchedData)}
								disabled={fetchModelsMutation.isPending || putMutation.isPending}
								className="shrink-0 gap-1.5"
							>
								{fetchModelsMutation.isPending || putMutation.isPending ? (
									<HugeiconsIcon icon={Loading03Icon} size={14} strokeWidth={1.75} className="animate-spin" />
								) : (
									<HugeiconsIcon icon={Refresh01Icon} size={14} strokeWidth={1.75} />
								)}
								{putMutation.isPending ? "Saving…" : fetchModelsMutation.isPending ? "Fetching…" : "Fetch"}
							</Button>
						</div>

						{fetchModelsMutation.isPending && !resolvedFetchedData && <ModelsSkeleton />}

						{resolvedFetchedData &&
							!fetchModelsMutation.isPending &&
							(filteredFetchedModels.length > 0 ? (
								<ul className="divide-y divide-border/30">
									{filteredFetchedModels.map((model) => {
										const isEnabled = enabledModelIds.has(model.id);
										const uiCaps = toUiCapabilities(model);
										const ctxLabel = formatContextLimit(model.limit);
										return (
											<li
												key={model.id}
												className="flex items-center gap-3 px-4 py-2.5 transition-colors duration-150 hover:bg-muted/25"
											>
												<div className="min-w-0 flex-1">
													<div className="flex items-center gap-2">
														<span className="truncate font-mono text-[13px] text-foreground">
															{model.id}
														</span>
														{ctxLabel && (
															<span className="shrink-0 rounded bg-muted/60 px-1.5 py-px font-mono text-[10px] tabular-nums text-muted-foreground/70">
																{ctxLabel}
															</span>
														)}
													</div>
													{uiCaps && (
														<div className="mt-1">
															<CapabilityBadges capabilities={uiCaps} iconSize={12} />
														</div>
													)}
												</div>
												<Switch
													checked={isEnabled}
													onCheckedChange={(checked) => handleModelToggle(model.id, checked)}
													size="sm"
												/>
											</li>
										);
									})}
								</ul>
							) : (
								<div className="py-10 text-center">
									<p className="font-serif italic text-[13px] text-muted-foreground/55">
										{modelSearch ? "No models match your search." : "No models available."}
									</p>
								</div>
							))}

						{!resolvedFetchedData && !fetchModelsMutation.isPending && (
							<div className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center">
								<p className="font-serif text-[13.5px] italic text-muted-foreground/60">
									No models fetched yet.
								</p>
								<p className="max-w-[42ch] text-[12px] leading-snug text-muted-foreground/50">
									Fetch to discover the models {displayName} currently exposes. You can enable the ones you
									want to keep.
								</p>
								<Button
									variant="outline"
									size="sm"
									onClick={() => triggerFetch(false)}
									disabled={fetchModelsMutation.isPending || putMutation.isPending}
									className="gap-1.5"
								>
									<HugeiconsIcon icon={Refresh01Icon} size={14} strokeWidth={1.75} />
									Fetch models
								</Button>
							</div>
						)}
					</SettingsGroup>
				</div>
			</div>

			<div className="shrink-0 border-t border-border/35 bg-background/95 px-8 py-3.5 backdrop-blur" style={noDrag}>
				<div className="mx-auto flex max-w-[640px] items-center justify-between gap-3">
					<p
						className={cn(
							"font-serif italic text-[12.5px] transition-colors",
							hasChanges ? "text-amber-700/75" : "text-muted-foreground/50",
						)}
					>
						{hasChanges ? "You have unsaved changes." : "All changes saved."}
					</p>
					<div className="flex items-center gap-2">
						<Button variant="ghost" onClick={handleCancel} disabled={!hasChanges || putMutation.isPending}>
							Cancel
						</Button>
						<Button onClick={handleSave} disabled={!hasChanges || putMutation.isPending}>
							{putMutation.isPending ? "Saving…" : "Save"}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}

function ProviderIdentity({
	icon,
	name,
	description,
	enabled,
	onToggle,
	isCustom,
	onDelete,
}: {
	icon: React.ComponentType<{ size?: number; className?: string }> | null;
	name: string;
	description: string;
	enabled: boolean;
	onToggle: (checked: boolean) => void;
	isCustom: boolean;
	onDelete: () => void;
}) {
	return (
		<div className="flex items-start justify-between gap-4">
			<div className="flex min-w-0 items-start gap-3">
				<span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-card ring-1 ring-border/50">
					<BrandAvatar icon={icon} size={22} />
				</span>
				<div className="flex min-w-0 flex-col gap-1 pt-0.5">
					<div className="flex items-center gap-2">
						<h2 className="font-serif text-[22px] leading-tight tracking-tight text-foreground">{name}</h2>
						<span
							className={cn(
								"inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.12em]",
								enabled ? "text-primary-2" : "text-muted-foreground/45",
							)}
						>
							<span
								className={cn("size-1.5 rounded-full", enabled ? "bg-primary-2" : "bg-muted-foreground/30")}
							/>
							{enabled ? "Active" : "Disabled"}
						</span>
					</div>
					<p className="text-[13px] leading-relaxed text-muted-foreground/70">{description}</p>
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2 pt-1" style={noDrag}>
				{isCustom && (
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={onDelete}
						className="text-muted-foreground/60 hover:text-destructive"
						aria-label="Delete provider"
					>
						<HugeiconsIcon icon={Delete02Icon} size={15} strokeWidth={1.75} />
					</Button>
				)}
				<Switch checked={enabled} onCheckedChange={onToggle} size="sm" />
			</div>
		</div>
	);
}

function ModelsSkeleton() {
	return (
		<ul className="divide-y divide-border/30">
			{["s0", "s1", "s2", "s3", "s4"].map((key) => (
				<li key={key} className="flex items-center justify-between px-4 py-2.5">
					<div className="flex items-center gap-2">
						<div className="h-4 w-32 animate-pulse rounded bg-muted/40" />
						<div className="h-3 w-12 animate-pulse rounded bg-muted/30" />
					</div>
					<div className="h-4 w-8 animate-pulse rounded-full bg-muted/30" />
				</li>
			))}
		</ul>
	);
}
