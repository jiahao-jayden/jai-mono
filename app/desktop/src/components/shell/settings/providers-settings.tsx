import { type ReactNode, useState } from "react";
import { resolveProviderBrandIcon, useIcon } from "@/lib/icon-context";
import type {
	DesktopProviderAdapter,
	DesktopProviderFetchModelsResult,
	DesktopProviderPreset,
} from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { DropdownContent, DropdownMenu, DropdownSeparator, DropdownTrigger } from "../../ui/dropdown";
import { Input } from "../../ui/input";
import { MenuItem } from "../../ui/menu-item";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "../../ui/select";
import { ProviderModelEditor } from "./provider-model-editor";
import { type ProfileDraft, uniqueProfileId } from "./provider-settings-types";

interface ProvidersSettingsProps {
	readonly providerPresets: readonly DesktopProviderPreset[];
	readonly profiles: ProfileDraft[];
	readonly selectedProfileId: string;
	readonly onProfilesChange: (profiles: ProfileDraft[]) => void;
	readonly onSelectedProfileChange: (id: string) => void;
	readonly onFetchModels: (profileId: string) => Promise<void>;
	readonly onRevealApiKey: (profileId: string) => Promise<string>;
	readonly fetchingProfileId?: string;
	readonly lastFetch?: DesktopProviderFetchModelsResult;
}

export function ProvidersSettings({
	providerPresets,
	profiles,
	selectedProfileId,
	onProfilesChange,
	onSelectedProfileChange,
	onFetchModels,
	onRevealApiKey,
	fetchingProfileId,
	lastFetch,
}: ProvidersSettingsProps) {
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
												<SelectItem index={0} value="openai-responses">
													OpenAI Responses
												</SelectItem>
												<SelectItem index={1} value="openai-compatible">
													OpenAI compatible
												</SelectItem>
												<SelectItem index={2} value="anthropic">
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

						<ProviderModelEditor
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
						icon={resolveProviderBrandIcon(preset.catalogProvider)}
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

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<div className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium">
			<span>{label}</span>
			{children}
		</div>
	);
}

function maskApiKey(value: string): string {
	return `•••• ${value.slice(-4)}`;
}
