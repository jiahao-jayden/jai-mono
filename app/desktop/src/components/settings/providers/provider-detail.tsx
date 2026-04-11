import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ConfigResponse, FetchModelsResponse, ProviderModel, ProviderSettings } from "@jayden/jai-gateway";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLinkIcon, EyeIcon, EyeOffIcon, LoaderIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { useCallback, useMemo, useState } from "react";
import { CapabilityBadges } from "@/components/common/capability-badges";
import { BrandAvatar, resolveProviderIcon } from "@/components/common/provider-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";
import type { ModelCapabilities } from "@/stores/chat";
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
	const isConfigured = !!providerConfig;

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

	const displayName = builtin?.name ?? providerId;
	const description = builtin?.description ?? "Custom provider";
	const resolvedIcon = resolveProviderIcon(providerId);

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
			<div className="flex-1 min-h-0 px-6 py-5">
				<div className="flex h-full max-w-xl flex-col gap-6">
					<div className="flex items-start justify-between">
						<div className="space-y-1">
							<div className="flex items-center gap-2.5">
								<BrandAvatar icon={resolvedIcon?.icon ?? null} size={24} />
								<h2 className="text-lg font-semibold tracking-tight">{displayName}</h2>
								{isConfigured && draftConfig.enabled && (
									<Badge variant="secondary" className="text-[10px] font-medium">
										Active
									</Badge>
								)}
							</div>
							<p className="text-[13px] text-muted-foreground/50">{description}</p>
						</div>
						<div className="flex items-center gap-2" style={noDrag}>
							{!BUILTIN_IDS.has(providerId) && (
								<Button variant="destructive" size="icon-sm" onClick={() => deleteMutation.mutate()}>
									<Trash2Icon className="size-3.5" />
								</Button>
							)}
							<Switch checked={draftConfig.enabled} onCheckedChange={handleToggle} size="sm" />
						</div>
					</div>

					<Separator className="opacity-30" />

					<div className="space-y-2">
						<Label className="text-[13px] text-muted-foreground">API Key</Label>
						<div className="relative">
							<Input
								type={showKey ? "text" : "password"}
								value={draftConfig.api_key ?? ""}
								placeholder="sk-..."
								className="pr-10 font-mono text-[13px]"
								onChange={(e) =>
									setDraftConfig((prev) => ({
										...prev,
										api_key: e.target.value || undefined,
									}))
								}
							/>
							<button
								type="button"
								onClick={() => setShowKey(!showKey)}
								className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
							>
								{showKey ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
							</button>
						</div>
						{builtin?.apiKeyUrl && (
							<a
								href={builtin.apiKeyUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
							>
								Get your API key from {displayName}
								<ExternalLinkIcon className="size-3" />
							</a>
						)}
					</div>

					<div className="space-y-2">
						<Label className="text-[13px] text-muted-foreground">
							Base URL{builtin && <span className="ml-1 text-muted-foreground/30">(Optional)</span>}
						</Label>
						<Input
							value={draftConfig.api_base}
							placeholder={defaults.api_base || "https://api.example.com/v1"}
							className="font-mono text-[13px]"
							onChange={(e) =>
								setDraftConfig((prev) => ({
									...prev,
									api_base: e.target.value,
								}))
							}
						/>
						{builtin && (
							<p className="text-[11px] text-muted-foreground/30">
								Leave empty to use the default {displayName} endpoint
							</p>
						)}
					</div>

					{!builtin && (
						<div className="space-y-2">
							<Label className="text-[13px] text-muted-foreground">API Format</Label>
							<Select value={draftConfig.api_format} onValueChange={handleFormatChange}>
								<SelectTrigger className="w-full">
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
						</div>
					)}

					<Separator className="opacity-30" />

					<div className="flex min-h-0 flex-1 flex-col">
						<div className="mb-3 flex items-center justify-between">
							<Label className="text-[13px] text-muted-foreground">Models</Label>
							<div className="flex items-center gap-2">
								{resolvedFetchedData && (
									<span
										className={cn(
											"text-[11px] tabular-nums",
											Date.now() - resolvedFetchedData.fetchedAt > 3600000
												? "text-amber-500/60"
												: "text-muted-foreground/30",
										)}
									>
										Fetched {timeAgo(resolvedFetchedData.fetchedAt)}
									</span>
								)}
								<span className="text-[11px] text-muted-foreground/30 tabular-nums">
									{enabledModelIds.size} enabled
								</span>
							</div>
						</div>

						<div className="mb-3 flex gap-2">
							<div className="relative flex-1">
								<HugeiconsIcon
									icon={Search01Icon}
									size={14}
									strokeWidth={2}
									className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40"
								/>
								<Input
									value={modelSearch}
									onChange={(e) => setModelSearch(e.target.value)}
									placeholder="Search models..."
									className="pl-8 text-[13px]"
								/>
							</div>
							<Button
								variant="outline"
								size="sm"
								onClick={async () => {
									if (!draftConfig.api_key) {
										toast.error("Please enter an API key first");
										return;
									}
									if (hasFetchConfigChanges) {
										await putMutation.mutateAsync(draftConfig);
									}
									fetchModelsMutation.mutate(!resolvedFetchedData);
								}}
								disabled={fetchModelsMutation.isPending || putMutation.isPending}
								className="shrink-0 gap-1.5"
							>
								{fetchModelsMutation.isPending || putMutation.isPending ? (
									<LoaderIcon className="size-3.5 animate-spin" />
								) : (
									<RefreshCwIcon className="size-3.5" />
								)}
								{putMutation.isPending ? "Saving..." : fetchModelsMutation.isPending ? "Fetching..." : "Fetch"}
							</Button>
						</div>

					{fetchModelsMutation.isPending && !resolvedFetchedData && (
							<div className="flex-1 space-y-0 divide-y divide-border/20 overflow-hidden rounded-xl border border-border/20">
								{["s0", "s1", "s2", "s3", "s4"].map((key) => (
									<div key={key} className="flex items-center justify-between px-3 py-2.5">
										<div className="flex items-center gap-2">
											<div className="h-4 w-32 animate-pulse rounded bg-muted/40" />
											<div className="h-3 w-12 animate-pulse rounded bg-muted/30" />
										</div>
										<div className="h-4 w-8 animate-pulse rounded-full bg-muted/30" />
									</div>
								))}
							</div>
						)}

						{resolvedFetchedData && !fetchModelsMutation.isPending && (
							<ScrollArea className="min-h-0 flex-1 rounded-xl border border-border/20">
								{filteredFetchedModels.length > 0 ? (
									<div className="divide-y divide-border/20">
										{filteredFetchedModels.map((model) => {
											const isEnabled = enabledModelIds.has(model.id);
											const uiCaps = toUiCapabilities(model);
											const ctxLabel = formatContextLimit(model.limit);
											return (
												<div
													key={model.id}
													className="flex items-center gap-3 px-3 py-2 transition-colors duration-150 hover:bg-muted/20"
												>
													<div className="min-w-0 flex-1">
														<div className="flex items-center gap-2">
															<span className="truncate font-mono text-[13px]">{model.id}</span>
															{ctxLabel && (
																<span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/40">
																	{ctxLabel}
																</span>
															)}
														</div>
														{uiCaps && (
															<div className="mt-0.5">
																<CapabilityBadges capabilities={uiCaps} iconSize={12} />
															</div>
														)}
													</div>
													<Switch
														checked={isEnabled}
														onCheckedChange={(checked) => handleModelToggle(model.id, checked)}
														size="sm"
													/>
												</div>
											);
										})}
									</div>
								) : (
									<div className="py-6 text-center">
										<p className="text-[13px] text-muted-foreground/30">
											{modelSearch ? "No models match your search" : "No models available"}
										</p>
									</div>
								)}
							</ScrollArea>
						)}

						{!resolvedFetchedData && !fetchModelsMutation.isPending && (
							<div className="flex flex-1 flex-col items-center justify-center space-y-3 rounded-xl border border-dashed border-border/30 py-8 text-center">
								<p className="text-[13px] text-muted-foreground/30">No models fetched yet</p>
								<p className="text-[11px] text-muted-foreground/20">
									Click Fetch to discover available models from {displayName}
								</p>
								<Button
									variant="outline"
									size="sm"
									onClick={async () => {
										if (!draftConfig.api_key) {
											toast.error("Please enter an API key first");
											return;
										}
										if (hasFetchConfigChanges) {
											await putMutation.mutateAsync(draftConfig);
										}
										fetchModelsMutation.mutate(false);
									}}
									disabled={fetchModelsMutation.isPending || putMutation.isPending}
									className="gap-1.5"
								>
									<RefreshCwIcon className="size-3.5" />
									Fetch Models
								</Button>
							</div>
						)}
					</div>
				</div>
			</div>

			<div className="shrink-0 border-t border-border/30 bg-background/95 px-6 py-4 backdrop-blur" style={noDrag}>
				<div className="mx-auto flex max-w-xl items-center justify-between gap-3">
					<p className="text-[12px] text-muted-foreground/45">
						{hasChanges ? "You have unsaved changes." : "All changes saved."}
					</p>
					<div className="flex items-center gap-2">
						<Button variant="ghost" onClick={handleCancel} disabled={!hasChanges || putMutation.isPending}>
							Cancel
						</Button>
						<Button onClick={handleSave} disabled={!hasChanges || putMutation.isPending}>
							{putMutation.isPending ? "Saving..." : "Save"}
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
