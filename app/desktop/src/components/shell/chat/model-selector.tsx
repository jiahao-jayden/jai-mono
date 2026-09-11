import { Popover } from "@base-ui/react/popover";
import { cn } from "cn";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { type IntlShape, useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { Elevated } from "@/lib/elevated";
import { type IconComponent, resolveProviderBrandIcon, useIcons } from "@/lib/icon-context";
import { spring } from "@/lib/springs";
import { type DesktopProviderConfigSnapshot, isDesktopProviderModelRunnable } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { TooltipProvider } from "../../ui/tooltip";

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
	const intl = useIntl();
	const icons = useIcons();
	const reducedMotion = useReducedMotion() ?? false;
	const AllProvidersIcon = icons.layers;
	const ChevronDownIcon = icons["chevron-down"];
	const SearchIcon = icons.search;
	const SettingsIcon = icons.settings;
	const CheckIcon = icons.check;
	const ExternalLinkIcon = icons["arrow-up-right"];
	const [open, setOpen] = useState(false);
	const [hovered, setHovered] = useState(false);
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
					})),
				},
			];
		}) ?? [];
	const models = providers.flatMap((provider) => provider.models);
	const singleProvider = providers.length === 1;
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const modelGroups = providers
		.filter((provider) => !activeProviderId || provider.id === activeProviderId)
		.map((provider) => ({
			...provider,
			models: provider.models.filter(
				(model) =>
					!normalizedQuery ||
					[model.providerName, model.name, model.remoteModelId]
						.join(" ")
						.toLocaleLowerCase()
						.includes(normalizedQuery),
			),
		}))
		.filter((provider) => provider.models.length > 0);
	const visibleModels = modelGroups.flatMap((provider) => provider.models);
	const selectedModel = models.find((model) => model.ref === selectedModelRef);
	const status = resolveModelStatus(config, selectedModelRef, loading, error, intl);
	const triggerLabel = selectedModel ? selectedModel.name : status.label;
	const chevronVisible = !selectedModelRef || hovered || open;

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
						size="chip"
						disabled={disabled}
						active={open}
						onMouseEnter={() => setHovered(true)}
						onMouseLeave={() => setHovered(false)}
						aria-label={intl.formatMessage(desktopMessages.modelAria, { label: triggerLabel })}
						className="min-w-0 max-w-60 justify-start"
						contentClassName="min-w-0"
						labelClassName="flex min-w-0 items-center whitespace-nowrap"
					/>
				}
				title={status.title}
			>
				<span className="flex min-w-0 items-center">
					<AnimatePresence mode="popLayout" initial={false}>
						<motion.span
							key={selectedModelRef}
							className="min-w-0 flex-1 truncate"
							initial={reducedMotion ? { opacity: 0 } : { opacity: 0, transform: "translateX(8px)" }}
							animate={{ opacity: 1, transform: "translateX(0)" }}
							exit={reducedMotion ? { opacity: 0 } : { opacity: 0, transform: "translateX(-8px)" }}
							transition={spring.moderate}
						>
							{triggerLabel}
						</motion.span>
					</AnimatePresence>
					<motion.span
						className="shrink-0 overflow-hidden"
						animate={{ width: chevronVisible ? 18 : 0, opacity: chevronVisible ? 1 : 0 }}
						transition={spring.moderate}
					>
						<ChevronDownIcon size={14} className="ml-1 opacity-50" />
					</motion.span>
				</span>
			</Popover.Trigger>

			<Popover.Portal>
				<Popover.Positioner side="top" align="end" sideOffset={8} className="z-50 outline-none">
					<Popover.Popup
						render={<Elevated offset={2} shadowLevel={5} />}
						className="flex max-h-[min(440px,calc(100vh-120px))] w-[min(220px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg bg-popover outline-none transition-[opacity,transform] duration-150 ease-out data-starting-style:scale-[.96] data-starting-style:translate-y-[-2px] data-starting-style:opacity-0 data-ending-style:scale-[.96] data-ending-style:translate-y-[-2px] data-ending-style:opacity-0"
					>
						<div className="flex h-8 shrink-0 items-center gap-2 px-3">
							<SearchIcon size={15} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
							<Input
								key={open ? "open" : "closed"}
								autoFocus
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder={intl.formatMessage(desktopMessages.modelSearch)}
								aria-label={intl.formatMessage(desktopMessages.modelSearch)}
								className="h-7 border-0 bg-transparent px-0 text-[13.5px] shadow-none focus-visible:ring-0"
							/>
						</div>

						<div className="flex min-h-0">
							{!singleProvider && (
								<nav
									aria-label={intl.formatMessage(desktopMessages.modelProviders)}
									className="flex w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border py-2"
								>
									<ProviderFilterButton
										icon={AllProvidersIcon}
										label={intl.formatMessage(desktopMessages.modelAllProviders)}
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
									<ProviderFilterButton
										icon={SettingsIcon}
										label={intl.formatMessage(desktopMessages.modelManage)}
										active={false}
										onClick={manageModels}
										className="mt-auto"
									/>
								</nav>
							)}

							<div className="flex min-w-0 flex-1 flex-col">
								<TooltipProvider delayDuration={250}>
									<div
										role="listbox"
										aria-label={intl.formatMessage(desktopMessages.modelList)}
										className="min-h-0 max-h-[min(347px,calc(100vh-213px))] overflow-y-auto p-2"
									>
										{visibleModels.length > 0 ? (
											<div className="space-y-2">
												{modelGroups.map((provider) => {
													const ProviderIcon = provider.icon;
													return (
														<div key={provider.id}>
															{!activeProviderId && !singleProvider ? (
																<div className="flex h-7 items-center gap-1.5 px-2 text-[11.5px] font-medium text-muted-foreground">
																	<ProviderIcon size={15} strokeWidth={1.7} />
																	<span className="truncate">{provider.name}</span>
																</div>
															) : null}
															{provider.models.map((model) => {
																const selected = model.ref === selectedModelRef;
																return (
																	<Button
																		key={model.ref}
																		type="button"
																		variant="ghost"
																		size="md"
																		role="option"
																		aria-selected={selected}
																		onClick={() => chooseModel(model.ref)}
																		contentClassName="w-full min-w-0 justify-start"
																		labelClassName="flex min-w-0 w-full"
																		className="h-[30px] w-full justify-start rounded-[10px] px-2 text-left outline-none transition-colors duration-75 focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset"
																	>
																		<span className="flex min-w-0 w-full items-center gap-3 pointer-events-none">
																			<span className="min-w-0 flex-1 truncate text-[13.5px] font-normal text-foreground">
																				{model.name}
																			</span>
																			{selected ? (
																				<CheckIcon
																					size={16}
																					strokeWidth={2}
																					className="shrink-0 text-foreground"
																				/>
																			) : null}
																		</span>
																	</Button>
																);
															})}
														</div>
													);
												})}
											</div>
										) : (
											<div className="px-3 py-2 text-center text-[12.5px] text-muted-foreground">
												{models.length === 0
													? intl.formatMessage(desktopMessages.modelEmpty)
													: intl.formatMessage(desktopMessages.modelNoMatch)}
											</div>
										)}
									</div>
								</TooltipProvider>
							</div>
						</div>
						{singleProvider && (
							<div className="flex shrink-0 items-center border-t border-border px-2 py-1">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={manageModels}
									className="w-full justify-start px-2 text-[13.5px] text-foreground"
									contentClassName="w-full justify-start"
									labelClassName="flex w-full items-center justify-between"
								>
									<span className="font-normal">{intl.formatMessage(desktopMessages.modelManage)}</span>
									<ExternalLinkIcon size={14} strokeWidth={1.5} className="shrink-0" />
								</Button>
							</div>
						)}
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
	className,
	onClick,
}: {
	icon: IconComponent;
	label: string;
	active: boolean;
	className?: string;
	onClick(): void;
}) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-lg"
			active={active}
			aria-label={label}
			title={label}
			onClick={onClick}
			className={cn(
				"flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-none transition-colors duration-75 focus-visible:ring-3 focus-visible:ring-ring",
				active && "text-foreground",
				className,
			)}
		>
			<Icon size={18} strokeWidth={active ? 2 : 1.5} />
		</Button>
	);
}

function resolveModelStatus(
	config: DesktopProviderConfigSnapshot | undefined,
	modelRef: string,
	loading: boolean,
	error: boolean,
	intl: IntlShape,
): { readonly label: string; readonly title: string } {
	if (loading) {
		return {
			label: intl.formatMessage(desktopMessages.modelLoading),
			title: intl.formatMessage(desktopMessages.modelLoadingTitle),
		};
	}
	if (error) {
		return {
			label: intl.formatMessage(desktopMessages.modelUnavailable),
			title: intl.formatMessage(desktopMessages.modelRetryTitle),
		};
	}
	if (!modelRef) {
		return {
			label: intl.formatMessage(desktopMessages.modelChoose),
			title: intl.formatMessage(desktopMessages.modelConfigureTitle),
		};
	}
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
			: intl.formatMessage(desktopMessages.modelCredentialRequired),
	};
}
