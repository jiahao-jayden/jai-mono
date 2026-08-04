import { useState } from "react";
import { useIcon, useIcons } from "@/lib/icon-context";
import type {
	DesktopProviderConfigInput,
	DesktopProviderConfigSnapshot,
	DesktopProviderFetchModelsResult,
} from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../ui/dialog";
import { GeneralSettings } from "./general-settings";
import { type ProfileDraft, toProfileDraft, validateProviderDraft } from "./provider-settings-types";
import { ProvidersSettings } from "./providers-settings";

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

type SettingsCategory = "general" | "providers";

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

interface ProviderConfigFormProps {
	readonly snapshot: DesktopProviderConfigSnapshot;
	readonly onSave: (input: DesktopProviderConfigInput) => Promise<DesktopProviderConfigSnapshot>;
	readonly onFetchModels: (profileId: string) => Promise<DesktopProviderFetchModelsResult>;
	readonly onRevealApiKey: (profileId: string) => Promise<string>;
	readonly fetchingProfileId?: string;
	readonly lastFetch?: DesktopProviderFetchModelsResult;
}

function ProviderConfigForm({
	snapshot,
	onSave,
	onFetchModels,
	onRevealApiKey,
	fetchingProfileId,
	lastFetch,
}: ProviderConfigFormProps) {
	const icons = useIcons();
	const [category, setCategory] = useState<SettingsCategory>("general");
	const [profiles, setProfiles] = useState<ProfileDraft[]>(() => snapshot.profiles.map(toProfileDraft));
	const [selectedProfileId, setSelectedProfileId] = useState(snapshot.profiles[0]?.id ?? "");
	const [language, setLanguage] = useState(snapshot.language ?? "");
	const [maxIterations, setMaxIterations] = useState(snapshot.maxIterations?.toString() ?? "");
	const [reasoningEffort, setReasoningEffort] = useState(snapshot.reasoningEffort ?? "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const [dirty, setDirty] = useState(false);
	const canSave = profiles.length > 0 || snapshot.profiles.length > 0;

	const submit = async () => {
		const validationError = validateProviderDraft(profiles, language, maxIterations);
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
			setProfiles(savedSnapshot.profiles.map(toProfileDraft));
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
				<nav className="flex w-44 shrink-0 flex-col gap-0.5 bg-muted/25 p-3" aria-label="Settings">
					{categories.map((item) => {
						const Icon = icons[item.icon];
						return (
							<Button
								type="button"
								variant="navigation"
								size="md"
								leadingIcon={Icon}
								key={item.id}
								onClick={() => setCategory(item.id)}
								active={category === item.id}
								aria-current={category === item.id ? "page" : undefined}
								className={`h-auto w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] ${
									category === item.id ? "font-semibold text-foreground" : "text-foreground/75"
								}`}
							>
								{item.label}
							</Button>
						);
					})}
				</nav>

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
															...toProfileDraft(fetchedProfile),
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
