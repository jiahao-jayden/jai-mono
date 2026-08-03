import type { IconType } from "@lobehub/icons";
import Anthropic from "@lobehub/icons/es/Anthropic";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Kimi from "@lobehub/icons/es/Kimi";
import Minimax from "@lobehub/icons/es/Minimax";
import OpenAI from "@lobehub/icons/es/OpenAI";
import { useState } from "react";
import { type IconComponent, type IconComponentProps, useIcon, useIcons } from "@/lib/icon-context";
import {
	type DesktopProviderAdapter,
	type DesktopProviderConfigInput,
	type DesktopProviderConfigSnapshot,
	type DesktopProviderFetchModelsResult,
	type DesktopProviderModel,
	type DesktopProviderPreset,
	type DesktopProviderProfile,
	isDesktopProviderModelRunnable,
} from "../../../../shared/desktop-rpc";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { CheckboxGroup, CheckboxItem } from "../../ui/checkbox-group";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog";
import { DropdownContent, DropdownMenu, DropdownSeparator, DropdownTrigger } from "../../ui/dropdown";
import { Input } from "../../ui/input";
import { MenuItem } from "../../ui/menu-item";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "../../ui/select";
import { Tooltip, TooltipProvider } from "../../ui/tooltip";

interface ProviderSettingsDialogProps {
	readonly open: boolean;
	readonly snapshot?: DesktopProviderConfigSnapshot;
	readonly loading: boolean;
	readonly loadError: boolean;
	readonly onOpenChange: (open: boolean) => void;
	readonly onRetry: () => void;
	readonly onSave: (input: DesktopProviderConfigInput) => Promise<DesktopProviderConfigSnapshot>;
	readonly onFetchModels: (profileId: string) => Promise<DesktopProviderFetchModelsResult>;
	readonly onRevealApiKey: (profileId: string) => Promise<string>;
}

interface ProfileDraft extends DesktopProviderProfile {
	apiKey: string;
	clearApiKey: boolean;
	models: DesktopProviderModel[];
	persistedId?: string;
}

type SettingsCategory = "general" | "providers";

const profileIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_VISIBLE_MODELS = 100;

function createBrandIcon(Brand: IconType): IconComponent {
	return function BrandIcon({ size = 16, className }: IconComponentProps) {
		return <Brand aria-hidden="true" className={className} size={size} />;
	};
}

const providerBrandIcons: Readonly<Record<string, IconComponent>> = {
	anthropic: createBrandIcon(Anthropic),
	deepseek: createBrandIcon(DeepSeek),
	minimax: createBrandIcon(Minimax),
	moonshotai: createBrandIcon(Kimi),
	openai: createBrandIcon(OpenAI),
};

function resolveProviderBrandIcon(providerId?: string, modelId?: string): IconComponent | undefined {
	const explicit = providerId ? providerBrandIcons[providerId.toLocaleLowerCase()] : undefined;
	if (explicit) return explicit;
	const normalizedModelId = modelId?.toLocaleLowerCase() ?? "";
	if (normalizedModelId.startsWith("claude-")) return providerBrandIcons.anthropic;
	if (/^(gpt-|chatgpt-|o[1-9]|codex-)/.test(normalizedModelId)) return providerBrandIcons.openai;
	if (normalizedModelId.startsWith("deepseek-")) return providerBrandIcons.deepseek;
	if (normalizedModelId.startsWith("minimax-")) return providerBrandIcons.minimax;
	if (normalizedModelId.startsWith("kimi-") || normalizedModelId.startsWith("moonshot-")) {
		return providerBrandIcons.moonshotai;
	}
	return undefined;
}

export function ProviderSettingsDialog({
	open,
	snapshot,
	loading,
	loadError,
	onOpenChange,
	onRetry,
	onSave,
	onFetchModels,
	onRevealApiKey,
}: ProviderSettingsDialogProps) {
	const [fetchingProfileId, setFetchingProfileId] = useState<string>();
	const [lastFetch, setLastFetch] = useState<DesktopProviderFetchModelsResult>();
	const fetchModels = async (profileId: string) => {
		setFetchingProfileId(profileId);
		try {
			const result = await onFetchModels(profileId);
			setLastFetch(result);
			return result;
		} finally {
			setFetchingProfileId(undefined);
		}
	};
	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) setLastFetch(undefined);
				onOpenChange(nextOpen);
			}}
		>
			<DialogContent
				size="lg"
				className="h-[min(600px,calc(100vh-48px))] max-w-220 overflow-hidden bg-background p-0"
			>
				{snapshot ? (
					<ProviderConfigForm
						snapshot={snapshot}
						onSave={onSave}
						onFetchModels={fetchModels}
						onRevealApiKey={onRevealApiKey}
						fetchingProfileId={fetchingProfileId}
						lastFetch={lastFetch}
					/>
				) : (
					<ProviderLoadState loading={loading} error={loadError} onRetry={onRetry} />
				)}
			</DialogContent>
		</Dialog>
	);
}

function ProviderLoadState({
	loading,
	error,
	onRetry,
}: {
	readonly loading: boolean;
	readonly error: boolean;
	readonly onRetry: () => void;
}) {
	const SettingsIcon = useIcon("settings");

	return (
		<div className="flex h-full min-h-0 flex-col">
			<DialogHeader className="px-6 py-5">
				<DialogTitle>Settings</DialogTitle>
			</DialogHeader>
			<div className="flex flex-1 items-center justify-center px-6 text-center">
				<div>
					<SettingsIcon className="mx-auto mb-3 size-5 text-muted-foreground" />
					<p className="text-[14px] font-semibold">{loading ? "Loading settings…" : "Settings unavailable"}</p>
				</div>
			</div>
			{error ? (
				<DialogFooter className="px-6 py-4">
					<Button type="button" variant="tertiary" onClick={onRetry}>
						Retry
					</Button>
				</DialogFooter>
			) : null}
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/*                              Settings Shell                                */
/* -------------------------------------------------------------------------- */

function ProviderConfigForm({
	snapshot,
	onSave,
	onFetchModels,
	onRevealApiKey,
	fetchingProfileId,
	lastFetch,
}: {
	readonly snapshot: DesktopProviderConfigSnapshot;
	readonly onSave: (input: DesktopProviderConfigInput) => Promise<DesktopProviderConfigSnapshot>;
	readonly onFetchModels: (profileId: string) => Promise<DesktopProviderFetchModelsResult>;
	readonly onRevealApiKey: (profileId: string) => Promise<string>;
	readonly fetchingProfileId?: string;
	readonly lastFetch?: DesktopProviderFetchModelsResult;
}) {
	const icons = useIcons();
	const [category, setCategory] = useState<SettingsCategory>("general");
	const [profiles, setProfiles] = useState<ProfileDraft[]>(() => snapshot.profiles.map(toDraft));
	const [selectedProfileId, setSelectedProfileId] = useState(snapshot.profiles[0]?.id ?? "");
	const [language, setLanguage] = useState(snapshot.language ?? "");
	const [maxIterations, setMaxIterations] = useState(snapshot.maxIterations?.toString() ?? "");
	const [reasoningEffort, setReasoningEffort] = useState(snapshot.reasoningEffort ?? "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const [dirty, setDirty] = useState(false);
	const canSave = profiles.length > 0 || snapshot.profiles.length > 0;

	const submit = async () => {
		const validationError = validateDraft(profiles, language, maxIterations);
		if (validationError) {
			setError(validationError);
			return;
		}
		setSaving(true);
		setError(undefined);
		try {
			const savedSnapshot = await onSave({
				revision: snapshot.revision,
				...(language ? { language } : {}),
				...(maxIterations ? { maxIterations: Number(maxIterations) } : {}),
				...(reasoningEffort ? { reasoningEffort: reasoningEffort as "low" | "medium" | "high" } : {}),
				profiles: profiles.map(
					({ credentialConfigured: _configured, credentialMask: _mask, persistedId, ...profile }) => ({
						id: profile.id,
						...(persistedId && persistedId !== profile.id ? { previousId: persistedId } : {}),
						name: profile.name,
						adapter: profile.adapter,
						baseURL: profile.baseURL,
						authentication: profile.authentication,
						...(profile.apiKey ? { apiKey: profile.apiKey } : {}),
						...(profile.clearApiKey ? { clearApiKey: true } : {}),
						models: profile.models,
					}),
				),
			});
			setProfiles(savedSnapshot.profiles.map(toDraft));
			setDirty(false);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "配置未保存，请重试。");
		} finally {
			setSaving(false);
		}
	};

	const categories: { id: SettingsCategory; label: string; icon: keyof typeof icons }[] = [
		{ id: "general", label: "General", icon: "settings" },
		{ id: "providers", label: "Providers", icon: "key" },
	];

	return (
		<form
			className="flex h-full min-h-0 flex-col"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<DialogHeader className="px-6 pt-5 mb-0">
				<DialogTitle>Settings</DialogTitle>
			</DialogHeader>

			<div className="flex min-h-0 flex-1">
				{/* Category sidebar */}
				<nav className="flex w-44 shrink-0 flex-col gap-0.5 bg-muted/25 p-3" aria-label="Settings">
					{categories.map((cat) => {
						const Icon = icons[cat.icon];
						return (
							<Button
								type="button"
								variant="navigation"
								size="md"
								leadingIcon={Icon}
								key={cat.id}
								onClick={() => setCategory(cat.id)}
								active={category === cat.id}
								aria-current={category === cat.id ? "page" : undefined}
								className={`h-auto w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] ${
									category === cat.id ? "font-semibold text-foreground" : "text-foreground/75"
								}`}
							>
								{cat.label}
							</Button>
						);
					})}
				</nav>

				{/* Content area */}
				<div className="min-w-0 flex-1 overflow-y-auto">
					{category === "general" ? (
						<GeneralSettings
							language={language}
							maxIterations={maxIterations}
							reasoningEffort={reasoningEffort}
							onLanguageChange={(value) => {
								setLanguage(value);
								setDirty(true);
							}}
							onMaxIterationsChange={(value) => {
								setMaxIterations(value);
								setDirty(true);
							}}
							onReasoningEffortChange={(value) => {
								setReasoningEffort(value);
								setDirty(true);
							}}
						/>
					) : (
						<ProvidersSettings
							providerPresets={snapshot.providerPresets ?? []}
							profiles={profiles}
							selectedProfileId={selectedProfileId}
							onProfilesChange={(nextProfiles) => {
								setProfiles(nextProfiles);
								setDirty(true);
							}}
							onSelectedProfileChange={setSelectedProfileId}
							onFetchModels={async (profileId) => {
								if (dirty) {
									setError("Save connection changes before fetching models.");
									return;
								}
								setError(undefined);
								try {
									const result = await onFetchModels(profileId);
									const fetchedProfile = result.snapshot.profiles.find((profile) => profile.id === profileId);
									if (fetchedProfile) {
										setProfiles((currentProfiles) =>
											currentProfiles.map((profile) =>
												profile.id === profileId
													? {
															...toDraft(fetchedProfile),
															apiKey: profile.apiKey,
															clearApiKey: profile.clearApiKey,
															persistedId: profile.persistedId,
														}
													: profile,
											),
										);
									}
									setSelectedProfileId(profileId);
									setCategory("providers");
								} catch (cause) {
									setError(cause instanceof Error ? cause.message : "Unable to fetch models.");
								}
							}}
							onRevealApiKey={onRevealApiKey}
							fetchingProfileId={fetchingProfileId}
							lastFetch={lastFetch}
						/>
					)}
				</div>
			</div>

			<DialogFooter className="items-center px-6 py-4">
				{error ? (
					<p className="mr-auto max-w-115 text-[12px] leading-relaxed text-destructive" role="alert">
						{error}
					</p>
				) : dirty ? (
					<p className="mr-auto flex items-center gap-1.5 text-[12px] text-muted-foreground" role="status">
						<span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
						Unsaved changes
					</p>
				) : null}
				<Button type="submit" loading={saving} disabled={!canSave}>
					Save
				</Button>
			</DialogFooter>
		</form>
	);
}

/* -------------------------------------------------------------------------- */
/*                             General Settings                               */
/* -------------------------------------------------------------------------- */

function GeneralSettings({
	language,
	maxIterations,
	reasoningEffort,
	onLanguageChange,
	onMaxIterationsChange,
	onReasoningEffortChange,
}: {
	readonly language: string;
	readonly maxIterations: string;
	readonly reasoningEffort: string;
	readonly onLanguageChange: (value: string) => void;
	readonly onMaxIterationsChange: (value: string) => void;
	readonly onReasoningEffortChange: (value: string) => void;
}) {
	return (
		<div className="px-8 py-6">
			<h2 className="text-[15px] font-semibold">Agent Defaults</h2>

			<div className="mt-5 flex flex-col gap-5">
				<SettingsRow label="Response language">
					<Input
						value={language}
						onChange={(event) => onLanguageChange(event.target.value)}
						placeholder="zh-CN"
						aria-label="Response language"
						autoComplete="off"
					/>
				</SettingsRow>

				<SettingsRow label="Max iterations">
					<Input
						type="number"
						min={1}
						value={maxIterations}
						onChange={(event) => onMaxIterationsChange(event.target.value)}
						placeholder="Unlimited"
						aria-label="Max iterations"
					/>
				</SettingsRow>

				<SettingsRow label="Reasoning effort">
					<Select
						value={reasoningEffort || "none"}
						onValueChange={(value) => onReasoningEffortChange(value === "none" ? "" : value)}
					>
						<SelectTrigger className="w-48" aria-label="Reasoning effort" />
						<SelectContent>
							<SelectGroup>
								<SelectItem index={0} value="none">
									Default
								</SelectItem>
								<SelectItem index={1} value="low">
									Low
								</SelectItem>
								<SelectItem index={2} value="medium">
									Medium
								</SelectItem>
								<SelectItem index={3} value="high">
									High
								</SelectItem>
							</SelectGroup>
						</SelectContent>
					</Select>
				</SettingsRow>
			</div>
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/*                            Providers Settings                              */
/* -------------------------------------------------------------------------- */

function ProvidersSettings({
	providerPresets,
	profiles,
	selectedProfileId,
	onProfilesChange,
	onSelectedProfileChange,
	onFetchModels,
	onRevealApiKey,
	fetchingProfileId,
	lastFetch,
}: {
	readonly providerPresets: readonly DesktopProviderPreset[];
	readonly profiles: ProfileDraft[];
	readonly selectedProfileId: string;
	readonly onProfilesChange: (profiles: ProfileDraft[]) => void;
	readonly onSelectedProfileChange: (id: string) => void;
	readonly onFetchModels: (profileId: string) => Promise<void>;
	readonly onRevealApiKey: (profileId: string) => Promise<string>;
	readonly fetchingProfileId?: string;
	readonly lastFetch?: DesktopProviderFetchModelsResult;
}) {
	const KeyIcon = useIcon("key");
	const TrashIcon = useIcon("trash");
	const selectedIndex = profiles.findIndex((profile) => profile.id === selectedProfileId);
	const selected = profiles[selectedIndex];

	const updateSelected = (update: (profile: ProfileDraft) => ProfileDraft) => {
		if (selectedIndex < 0) return;
		onProfilesChange(profiles.map((profile, index) => (index === selectedIndex ? update(profile) : profile)));
	};

	const addProfile = (preset?: DesktopProviderPreset) => {
		const id = uniqueProfileId(profiles, preset?.id ?? "provider");
		const profile: ProfileDraft = {
			id,
			name: preset?.name ?? "New provider",
			adapter: preset?.adapter ?? "openai-compatible",
			baseURL: preset?.baseURL ?? "",
			authentication: preset?.authentication ?? "api-key",
			credentialConfigured: false,
			models: [],
			apiKey: "",
			clearApiKey: false,
		};
		onProfilesChange([...profiles, profile]);
		onSelectedProfileChange(id);
	};

	const removeSelected = () => {
		if (!selected) return;
		const nextProfiles = profiles.filter((_, index) => index !== selectedIndex);
		onProfilesChange(nextProfiles);
		onSelectedProfileChange(nextProfiles[Math.min(selectedIndex, nextProfiles.length - 1)]?.id ?? "");
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* Provider tab bar */}
			<div className="flex items-center gap-1 px-6 pt-3 pb-0">
				<div className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
					{profiles.map((profile) => (
						<Button
							type="button"
							variant="ghost"
							size="md"
							key={profile.id}
							onClick={() => onSelectedProfileChange(profile.id)}
							className={`relative flex shrink-0 items-center gap-1.5 rounded-t-lg px-3 pb-2.5 pt-2 text-[13px] transition-colors ${
								profile.id === selectedProfileId
									? "font-medium text-foreground after:absolute after:bottom-0 after:left-2 after:right-2 after:h-0.5 after:rounded-full after:bg-foreground"
									: "text-muted-foreground hover:text-foreground"
							}`}
						>
							<span
								className={`size-1.5 shrink-0 rounded-full ${
									profile.authentication === "none" || profile.credentialConfigured || profile.apiKey
										? "bg-primary-2"
										: "bg-muted-foreground/30"
								}`}
							/>
							<span className="max-w-28 truncate">{profile.name}</span>
						</Button>
					))}
				</div>
				<AddProviderMenu providerPresets={providerPresets} onAdd={addProfile} compact />
			</div>

			{/* Provider content */}
			<div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
				{selected ? (
					<div className="flex flex-col gap-5">
						<section className="flex flex-col gap-4">
							<div className="flex items-center justify-between">
								<h3 className="text-[14px] font-semibold">Connection</h3>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									onClick={removeSelected}
									aria-label={`Delete ${selected.name}`}
									title="Delete provider"
								>
									<TrashIcon />
								</Button>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<Field label="Profile name">
									<Input
										value={selected.name}
										onChange={(event) =>
											updateSelected((profile) => ({ ...profile, name: event.target.value }))
										}
										aria-label="Profile name"
										autoComplete="off"
									/>
								</Field>
								<Field label="Adapter">
									<Select
										value={selected.adapter}
										onValueChange={(adapter) =>
											updateSelected((profile) => ({
												...profile,
												adapter: adapter as DesktopProviderAdapter,
												authentication: adapter === "anthropic" ? "api-key" : profile.authentication,
											}))
										}
									>
										<SelectTrigger className="w-full" aria-label="Adapter" />
										<SelectContent>
											<SelectGroup>
												<SelectItem index={0} value="openai-compatible">
													OpenAI compatible
												</SelectItem>
												<SelectItem index={1} value="anthropic">
													Anthropic Messages
												</SelectItem>
											</SelectGroup>
										</SelectContent>
									</Select>
								</Field>
							</div>
							<Field label="Endpoint">
								<Input
									type="url"
									value={selected.baseURL}
									onChange={(event) =>
										updateSelected((profile) => ({ ...profile, baseURL: event.target.value }))
									}
									placeholder="https://…"
									aria-label="Endpoint"
									autoComplete="url"
									spellCheck={false}
								/>
							</Field>
							{selected.authentication === "api-key" ? (
								<Field label="API key">
									<ApiKeyInput
										key={`${selected.id}:${selected.credentialMask ?? "new"}`}
										value={selected.apiKey}
										credentialConfigured={selected.credentialConfigured}
										credentialMask={selected.credentialMask}
										onReveal={() => onRevealApiKey(selected.id)}
										onChange={(apiKey) =>
											updateSelected((profile) => ({
												...profile,
												apiKey,
												clearApiKey: false,
											}))
										}
									/>
								</Field>
							) : null}
						</section>

						<ModelEditor
							key={selected.id}
							profile={selected}
							onModelsChange={(models) => updateSelected((profile) => ({ ...profile, models }))}
							onFetchModels={onFetchModels}
							fetching={fetchingProfileId === selected.id}
							lastFetch={lastFetch?.profileId === selected.id ? lastFetch : undefined}
						/>
					</div>
				) : (
					<div className="flex h-full min-h-72 items-center justify-center text-center">
						<div>
							<KeyIcon className="mx-auto mb-3 size-5 text-muted-foreground" />
							<p className="text-[14px] font-semibold">No Provider yet</p>
							<AddProviderMenu providerPresets={providerPresets} onAdd={addProfile} />
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function ApiKeyInput({
	value,
	credentialConfigured,
	credentialMask,
	onReveal,
	onChange,
}: {
	readonly value: string;
	readonly credentialConfigured: boolean;
	readonly credentialMask?: string;
	readonly onReveal: () => Promise<string>;
	readonly onChange: (value: string) => void;
}) {
	const KeyIcon = useIcon("key");
	const EyeIcon = useIcon("eye");
	const EyeOffIcon = useIcon("eye-off");
	const [revealed, setRevealed] = useState(false);
	const [revealedKey, setRevealedKey] = useState<string>();
	const [revealing, setRevealing] = useState(false);
	const [revealError, setRevealError] = useState<string>();
	const VisibilityIcon = revealed ? EyeOffIcon : EyeIcon;
	const visibilityLabel = revealed ? "Hide API key" : "Show API key";
	if (credentialConfigured) {
		const toggleReveal = async () => {
			if (revealed) {
				setRevealed(false);
				setRevealedKey(undefined);
				return;
			}
			if (value) {
				setRevealed(true);
				return;
			}
			setRevealing(true);
			setRevealError(undefined);
			try {
				setRevealedKey(await onReveal());
				setRevealed(true);
			} catch (cause) {
				setRevealError(cause instanceof Error ? cause.message : "Unable to reveal API key");
			} finally {
				setRevealing(false);
			}
		};
		const visibleValue = value || revealedKey || "";
		const maskedValue = value ? maskApiKey(value) : (credentialMask ?? "••••");
		return (
			<div className="flex flex-col gap-1">
				<div className="relative">
					<KeyIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
					{revealed ? (
						<Input
							type="text"
							value={visibleValue}
							onChange={(event) => onChange(event.target.value)}
							className="px-10 font-mono text-[12px]"
							aria-label="API key"
							autoComplete="off"
							spellCheck={false}
						/>
					) : (
						<div className="flex h-9 items-center rounded-lg border border-input bg-input/20 px-10">
							<code className="text-[12px] text-muted-foreground">{maskedValue}</code>
						</div>
					)}
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="absolute top-1/2 right-0.5 -translate-y-1/2"
						loading={revealing}
						onClick={() => void toggleReveal()}
						aria-label={visibilityLabel}
						title={visibilityLabel}
					>
						<VisibilityIcon />
					</Button>
				</div>
				{revealError ? (
					<p className="text-[11px] text-destructive" role="alert">
						{revealError}
					</p>
				) : null}
			</div>
		);
	}
	return (
		<div className="relative">
			<KeyIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				type={revealed ? "text" : "password"}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				placeholder={credentialConfigured ? "Enter replacement key" : "Enter API key"}
				className="px-10"
				aria-label="API key"
				autoComplete="new-password"
				spellCheck={false}
			/>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="absolute top-1/2 right-0.5 -translate-y-1/2"
				disabled={!value}
				onClick={() => setRevealed((current) => !current)}
				aria-label={visibilityLabel}
				title={visibilityLabel}
			>
				<VisibilityIcon />
			</Button>
		</div>
	);
}

function AddProviderMenu({
	providerPresets,
	onAdd,
	compact = false,
}: {
	readonly providerPresets: readonly DesktopProviderPreset[];
	readonly onAdd: (preset?: DesktopProviderPreset) => void;
	readonly compact?: boolean;
}) {
	const KeyIcon = useIcon("key");
	const PlusIcon = useIcon("plus");
	return (
		<DropdownMenu>
			<DropdownTrigger
				render={
					compact ? (
						<Button type="button" variant="ghost" size="icon-sm" title="Add provider" aria-label="Add provider">
							<PlusIcon />
						</Button>
					) : (
						<Button type="button" variant="secondary" size="sm" className="mt-4">
							Add provider
						</Button>
					)
				}
			/>
			<DropdownContent align="end" className="w-52">
				{providerPresets.map((preset, index) => (
					<MenuItem
						key={preset.id}
						index={index}
						icon={resolveProviderBrandIcon(preset.catalogProvider) ?? KeyIcon}
						label={preset.name}
						onSelect={() => onAdd(preset)}
					/>
				))}
				<DropdownSeparator />
				<MenuItem index={providerPresets.length} icon={PlusIcon} label="Custom provider" onSelect={() => onAdd()} />
			</DropdownContent>
		</DropdownMenu>
	);
}

/* -------------------------------------------------------------------------- */
/*                              Model Editor                                  */
/* -------------------------------------------------------------------------- */

function ModelEditor({
	profile,
	onModelsChange,
	onFetchModels,
	fetching,
	lastFetch,
}: {
	readonly profile: ProfileDraft;
	readonly onModelsChange: (models: DesktopProviderModel[]) => void;
	readonly onFetchModels: (profileId: string) => Promise<void>;
	readonly fetching: boolean;
	readonly lastFetch?: DesktopProviderFetchModelsResult;
}) {
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
								className="max-h-80 w-full gap-0.5 overflow-y-auto rounded-xl border border-border/70 bg-card p-1"
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
											className="h-auto min-h-13 items-center rounded-lg px-2.5 py-2 data-[disabled=true]:cursor-not-allowed"
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
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex min-w-0 items-center gap-2">
					{BrandIcon ? <BrandIcon size={17} className="shrink-0 text-foreground" /> : null}
					<div className="min-w-0 flex-1">
						<Tooltip content={model.remoteModelId} side="top" sideOffset={6}>
							<span className="block w-fit max-w-full truncate text-[13px] font-semibold text-foreground">
								{model.name}
							</span>
						</Tooltip>
					</div>
					<div className="flex items-center gap-0.5">
						<CapabilityIcon label="Tools" icon="terminal" value={model.toolCall} />
						<CapabilityIcon label="Structured output" icon="file-code" value={model.structuredOutput} />
						<CapabilityIcon label="Reasoning" icon="brain" value={model.reasoning} />
					</div>
					{availability.selectable ? null : (
						<Badge color={availability.verified ? "amber" : "orange"} size="sm">
							{availability.label}
						</Badge>
					)}
				</div>
				<div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px]">
					<div
						className="flex min-w-0 items-center gap-1.5"
						title={`Input: ${formatModalities(model.inputModalities)} → Output: ${formatModalities(model.outputModalities)}`}
					>
						<span className="text-muted-foreground">Modalities</span>
						<span className="truncate font-medium text-foreground">
							{formatModalities(model.inputModalities)}
						</span>
						<ArrowIcon size={11} className="shrink-0 text-muted-foreground" />
						<span className="truncate font-medium text-foreground">
							{formatModalities(model.outputModalities)}
						</span>
					</div>
					<div
						className="flex items-center gap-1.5"
						title={`Context: ${formatLimit(model.contextWindow)} · Input: ${formatLimit(model.inputLimit)} · Output: ${formatLimit(model.maxTokens)}`}
					>
						<span className="text-muted-foreground">Limits</span>
						<span>
							<span className="text-muted-foreground">Context </span>
							<span className="font-medium text-foreground">{formatCompactLimit(model.contextWindow)}</span>
						</span>
						<span className="text-muted-foreground/50">·</span>
						<span>
							<span className="text-muted-foreground">Input </span>
							<span className="font-medium text-foreground">{formatCompactLimit(model.inputLimit)}</span>
						</span>
						<span className="text-muted-foreground/50">·</span>
						<span>
							<span className="text-muted-foreground">Output </span>
							<span className="font-medium text-foreground">{formatCompactLimit(model.maxTokens)}</span>
						</span>
					</div>
				</div>
			</div>
		</TooltipProvider>
	);
}

function CapabilityIcon({
	label,
	icon,
	value,
}: {
	readonly label: string;
	readonly icon: "terminal" | "file-code" | "brain";
	readonly value: boolean | undefined;
}) {
	const Icon = useIcon(icon);
	const text = value === true ? "Supported" : value === false ? "Unsupported" : "Unknown";
	return (
		<Tooltip content={`${label} · ${text}`} side="top" sideOffset={6}>
			<span
				className={`flex size-6 items-center justify-center rounded-md transition-colors ${
					value === true
						? "text-foreground hover:bg-accent"
						: value === false
							? "text-muted-foreground/45 hover:bg-muted/50"
							: "text-muted-foreground hover:bg-muted/50"
				}`}
				aria-label={`${label}: ${text}`}
				role="img"
			>
				<Icon size={14} strokeWidth={1.6} />
			</span>
		</Tooltip>
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

function maskApiKey(value: string): string {
	return `•••• ${value.slice(-4)}`;
}

/* -------------------------------------------------------------------------- */
/*                          Shared field components                           */
/* -------------------------------------------------------------------------- */

function SettingsRow({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-6">
			<span className="text-[13.5px] font-medium">{label}</span>
			<div className="w-48 shrink-0">{children}</div>
		</div>
	);
}

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium">
			<span>{label}</span>
			{children}
		</div>
	);
}

/* -------------------------------------------------------------------------- */
/*                             Utilities                                      */
/* -------------------------------------------------------------------------- */

function toDraft(profile: DesktopProviderProfile): ProfileDraft {
	return { ...profile, models: [...profile.models], apiKey: "", clearApiKey: false, persistedId: profile.id };
}

function validateDraft(profiles: readonly ProfileDraft[], language: string, maxIterations: string): string | undefined {
	if (language && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language)) {
		return "Response language 必须是有效的 BCP-47 标记，例如 zh-CN。";
	}
	if (maxIterations && (!Number.isInteger(Number(maxIterations)) || Number(maxIterations) < 1)) {
		return "Max iterations 必须是正整数。";
	}
	const profileIds = new Set<string>();
	for (const profile of profiles) {
		if (!profile.name.trim()) return "每个 Provider 都需要名称。";
		if (!profileIdPattern.test(profile.id)) return `Profile ID "${profile.id}" 格式无效。`;
		if (profileIds.has(profile.id)) return `Profile ID "${profile.id}" 重复。`;
		profileIds.add(profile.id);
		if (profile.authentication === "api-key" && !profile.credentialConfigured && !profile.apiKey.trim()) {
			return `${profile.name} 需要 API key。`;
		}
	}
	return undefined;
}

function uniqueProfileId(profiles: readonly ProfileDraft[], base: string): string {
	const ids = new Set(profiles.map((profile) => profile.id));
	if (!ids.has(base)) return base;
	let suffix = 2;
	while (ids.has(`${base}-${suffix}`)) suffix++;
	return `${base}-${suffix}`;
}
