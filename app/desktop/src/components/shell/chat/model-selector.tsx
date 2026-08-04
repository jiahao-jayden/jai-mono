import { Popover } from "@base-ui/react/popover";
import { useState } from "react";
import { Elevated } from "@/lib/elevated";
import { type IconComponent, resolveProviderBrandIcon, useIcons } from "@/lib/icon-context";
import { type DesktopProviderConfigSnapshot, isDesktopProviderModelRunnable } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { TooltipProvider } from "../../ui/tooltip";
import { ModelCapabilities } from "../model-capabilities";

interface ModelSelectorProps {
	config?: DesktopProviderConfigSnapshot;
	selectedModelRef: string;
	loading: boolean;
	error: boolean;
	disabled: boolean;
	onSelect(modelRef: string): void;
	onManage(): void;
}

export function ModelSelector({
	config,
	selectedModelRef,
	loading,
	error,
	disabled,
	onSelect,
	onManage,
}: ModelSelectorProps) {
	const icons = useIcons();
	const AllProvidersIcon = icons.layers;
	const CheckIcon = icons.check;
	const ChevronDownIcon = icons["chevron-down"];
	const SearchIcon = icons.search;
	const SettingsIcon = icons.settings;
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeProviderId, setActiveProviderId] = useState<string>();

	const providers =
		config?.profiles.flatMap((profile) => {
			const runnableModels = profile.models.filter(
				(model) => model.enabled && isDesktopProviderModelRunnable(model),
			);
			if (runnableModels.length === 0) return [];
			const catalogProvider =
				config.providerPresets.find((preset) => preset.id === profile.id)?.catalogProvider ??
				runnableModels.find((model) => model.metadataProvider)?.metadataProvider ??
				profile.id;
			return [
				{
					id: profile.id,
					name: profile.name,
					icon: resolveProviderBrandIcon(catalogProvider, runnableModels[0]?.remoteModelId),
					models: runnableModels.map((model) => ({
						ref: `${profile.id}/${model.id}`,
						name: model.name,
						remoteModelId: model.remoteModelId,
						providerId: profile.id,
						providerName: profile.name,
						description: model.description,
						contextWindow: model.contextWindow,
						toolCall: model.toolCall,
						structuredOutput: model.structuredOutput,
						reasoning: model.reasoning,
						icon: resolveProviderBrandIcon(model.metadataProvider ?? catalogProvider, model.remoteModelId),
					})),
				},
			];
		}) ?? [];
	const models = providers.flatMap((provider) => provider.models);
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const visibleModels = models.filter(
		(model) =>
			(!activeProviderId || model.providerId === activeProviderId) &&
			(!normalizedQuery ||
				`${model.providerName} ${model.name} ${model.remoteModelId} ${model.description ?? ""}`
					.toLocaleLowerCase()
					.includes(normalizedQuery)),
	);
	const selectedModel = models.find((model) => model.ref === selectedModelRef);
	const status = resolveModelStatus(config, selectedModelRef, loading, error);
	const TriggerIcon = selectedModel?.icon ?? resolveProviderBrandIcon(undefined, selectedModelRef);
	const triggerLabel = selectedModel ? `${selectedModel.providerName} · ${selectedModel.name}` : status.label;

	const chooseModel = (modelRef: string) => {
		onSelect(modelRef);
		setOpen(false);
		setQuery("");
	};

	const manageModels = () => {
		setOpen(false);
		setQuery("");
		onManage();
	};

	return (
		<Popover.Root
			open={open}
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen);
				if (!nextOpen) setQuery("");
			}}
			modal={false}
		>
			<Popover.Trigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={disabled}
						active={open}
						aria-label={`Model: ${triggerLabel}`}
						className="min-w-0 max-w-60 justify-start px-2 text-[13px] font-medium text-foreground/80"
						contentClassName="min-w-0"
						labelClassName="flex min-w-0 items-center gap-1.5 whitespace-nowrap"
					/>
				}
				title={status.title}
			>
				<TriggerIcon size={16} className="shrink-0" />
				<span className="min-w-0 truncate">{triggerLabel}</span>
				<ChevronDownIcon size={14} className="shrink-0 text-muted-foreground" />
			</Popover.Trigger>

			<Popover.Portal>
				<Popover.Positioner side="top" align="end" sideOffset={8} className="z-50 outline-none">
					<Popover.Popup
						render={<Elevated offset={2} shadowLevel={5} />}
						className="flex max-h-[min(440px,calc(100vh-120px))] w-[min(460px,calc(100vw-32px))] flex-col overflow-hidden rounded-[14px] outline-none transition-opacity duration-150 data-starting-style:opacity-0 data-ending-style:opacity-0"
					>
						<div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-3">
							<SearchIcon size={17} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
							<Input
								key={open ? "open" : "closed"}
								autoFocus
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Search models…"
								aria-label="Search models"
								className="h-9 border-0 bg-transparent px-0 text-[13.5px] shadow-none focus-visible:ring-0"
							/>
						</div>

						<div className="flex min-h-0">
							<nav
								aria-label="Model providers"
								className="flex w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border/70 py-2"
							>
								<ProviderFilterButton
									icon={AllProvidersIcon}
									label="All providers"
									active={!activeProviderId}
									onClick={() => setActiveProviderId(undefined)}
								/>
								{providers.map((provider) => (
									<ProviderFilterButton
										key={provider.id}
										icon={provider.icon}
										label={provider.name}
										active={activeProviderId === provider.id}
										onClick={() => setActiveProviderId(provider.id)}
									/>
								))}
							</nav>

							<div className="flex min-w-0 flex-1 flex-col">
								<TooltipProvider delayDuration={250}>
									<div
										role="listbox"
										aria-label="Models"
										className="min-h-0 max-h-[min(347px,calc(100vh-213px))] overflow-y-auto p-2"
									>
										{visibleModels.length > 0 ? (
											<div>
												{visibleModels.map((model) => {
													const selected = model.ref === selectedModelRef;
													const ModelIcon = model.icon;
													return (
														<button
															key={model.ref}
															type="button"
															role="option"
															aria-selected={selected}
															onClick={() => chooseModel(model.ref)}
															className={`flex min-h-13 w-full cursor-pointer items-center gap-2 rounded-[10px] px-3 py-2.5 text-left outline-none transition-colors duration-75 ${selected ? "bg-accent text-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]" : "hover:bg-accent/55 active:bg-accent"} focus-visible:ring-2 focus-visible:ring-primary-2/45 focus-visible:ring-inset`}
														>
															<ModelIcon size={20} className="shrink-0 pointer-events-none" />
															<span className="min-w-0 flex-1 pointer-events-none">
																<span className="flex items-center gap-2">
																	<span className="min-w-0 truncate text-[13.5px] font-medium text-foreground">
																		{model.name}
																	</span>
																	{model.contextWindow ? (
																		<span className="shrink-0 text-[10.5px] font-medium text-muted-foreground">
																			{formatContextWindow(model.contextWindow)}
																		</span>
																	) : null}
																</span>
																<span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
																	{model.description ?? model.providerName}
																</span>
															</span>
															<ModelCapabilities model={model} />
															<span className="grid size-4 shrink-0 place-items-center text-foreground pointer-events-none">
																{selected ? <CheckIcon size={15} strokeWidth={2} /> : null}
															</span>
														</button>
													);
												})}
											</div>
										) : (
											<div className="grid h-full min-h-32 place-items-center px-6 text-center text-[12.5px] text-muted-foreground">
												{models.length === 0
													? "No runnable models yet. Set up a Provider or enable a compatible model."
													: "No models match your search."}
											</div>
										)}
									</div>
								</TooltipProvider>

								<div className="shrink-0 border-t border-border/70 p-2">
									<button
										type="button"
										onClick={manageModels}
										className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-[12.5px] text-muted-foreground outline-none cursor-pointer transition-colors duration-75 hover:bg-accent/55 hover:text-foreground active:bg-accent focus-visible:ring-2 focus-visible:ring-primary-2/45"
									>
										<SettingsIcon size={14} strokeWidth={1.5} className="shrink-0" />
										Manage models &amp; Providers…
									</button>
								</div>
							</div>
						</div>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

function ProviderFilterButton({
	icon: Icon,
	label,
	active,
	onClick,
}: {
	icon: IconComponent;
	label: string;
	active: boolean;
	onClick(): void;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={onClick}
			className={`flex size-9 shrink-0 items-center justify-center rounded-lg outline-none cursor-pointer transition-colors duration-75 ${active ? "bg-accent text-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]" : "text-muted-foreground hover:bg-accent/55 hover:text-foreground/80 active:bg-accent"} focus-visible:ring-2 focus-visible:ring-primary-2/45`}
		>
			<Icon size={18} strokeWidth={active ? 2 : 1.5} />
		</button>
	);
}

function formatContextWindow(tokens: number): string {
	if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
	if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
	return String(tokens);
}

function resolveModelStatus(
	config: DesktopProviderConfigSnapshot | undefined,
	modelRef: string,
	loading: boolean,
	error: boolean,
): { readonly label: string; readonly title: string } {
	if (loading) return { label: "Loading model…", title: "Loading Provider configuration" };
	if (error) return { label: "Model unavailable", title: "Open Provider settings to retry" };
	if (!modelRef) return { label: "Choose model", title: "Configure a Provider and model" };
	const separator = modelRef.indexOf("/");
	const profileId = modelRef.slice(0, separator);
	const modelId = modelRef.slice(separator + 1);
	const profile = config?.profiles.find((candidate) => candidate.id === profileId);
	const model = profile?.models.find((candidate) => candidate.id === modelId);
	const credentialReady = profile?.authentication === "none" || profile?.credentialConfigured === true;
	return {
		label: model?.name ?? modelRef,
		title: credentialReady
			? `${profile?.name ?? profileId} · ${model?.name ?? modelId}`
			: "Provider credential required",
	};
}
