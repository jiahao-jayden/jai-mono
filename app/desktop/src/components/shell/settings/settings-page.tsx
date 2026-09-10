import { useState } from "react";
import { type MessageDescriptor, useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { type IconName, useIcon, useIcons } from "@/lib/icon-context";
import { cn } from "cn";
import type {
	DesktopConnectorConfigInput,
	DesktopConnectorConfigSnapshot,
	DesktopConnectorOAuthStartResult,
	DesktopProviderConfigInput,
	DesktopProviderConfigSnapshot,
	DesktopProviderFetchModelsResult,
	DesktopTelemetryCredentialId,
	DesktopTelemetrySettingsInput,
	DesktopTelemetrySettingsSnapshot,
	DesktopWebSearchConfigInput,
	DesktopWebSearchConfigSnapshot,
	DesktopWebSearchCredentialId,
} from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { ConnectorSettings } from "./connector-settings";
import { GeneralSettings } from "./general-settings";
import { ObservabilitySettings } from "./observability-settings";
import {
	type ProfileDraft,
	type ProviderDraftValidationError,
	toProfileDraft,
	validateProviderDraft,
} from "./provider-settings-types";
import { ProvidersSettings } from "./providers-settings";
import { WebSearchSettings } from "./web-search-settings";

interface SettingsPageProps {
	readonly snapshot?: DesktopProviderConfigSnapshot;
	readonly loading: boolean;
	readonly loadError: boolean;
	readonly onRetry: () => void;
	readonly onSave: (input: DesktopProviderConfigInput) => Promise<DesktopProviderConfigSnapshot>;
	readonly onFetchModels: (profileId: string) => Promise<DesktopProviderFetchModelsResult>;
	readonly onRevealApiKey: (profileId: string) => Promise<string>;
	readonly onRevealWebSearchApiKey: (credentialId: DesktopWebSearchCredentialId) => Promise<string>;
	readonly onRevealConnectorCredential: (connectorId: string, credentialKey: string) => Promise<string>;
	readonly onRevealTelemetryCredential: (credentialId: DesktopTelemetryCredentialId) => Promise<string>;
	readonly onStartConnectorOAuth: (connectorId: string) => Promise<DesktopConnectorOAuthStartResult>;
	readonly onDisconnectConnectorOAuth: (connectorId: string) => Promise<DesktopProviderConfigSnapshot>;
	readonly telemetry?: DesktopTelemetrySettingsSnapshot;
	readonly telemetryLoading: boolean;
	readonly telemetryLoadError: boolean;
	readonly onSaveTelemetry: (input: DesktopTelemetrySettingsInput) => Promise<DesktopTelemetrySettingsSnapshot>;
}

type SettingsCategory = "general" | "providers" | "web-search" | "connector" | "advanced";

const settingsCategories: Record<SettingsCategory, { label: MessageDescriptor; icon: IconName }> = {
	general: { label: desktopMessages.settingsGeneral, icon: "settings" },
	providers: { label: desktopMessages.settingsProviders, icon: "key" },
	"web-search": { label: desktopMessages.settingsWebSearch, icon: "globe" },
	connector: { label: desktopMessages.settingsConnector, icon: "link" },
	advanced: { label: desktopMessages.settingsAdvanced, icon: "layers" },
};

export function SettingsPage({
	snapshot,
	loading,
	loadError,
	onRetry,
	onSave,
	onFetchModels,
	onRevealApiKey,
	onRevealWebSearchApiKey,
	onRevealConnectorCredential,
	onRevealTelemetryCredential,
	onStartConnectorOAuth,
	onDisconnectConnectorOAuth,
	telemetry,
	telemetryLoading,
	telemetryLoadError,
	onSaveTelemetry,
}: SettingsPageProps) {
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

	if (!snapshot) return <ProviderLoadState loading={loading} error={loadError} onRetry={onRetry} />;
	return (
		<ProviderConfigForm
			snapshot={snapshot}
			onSave={onSave}
			onFetchModels={fetchModels}
			onRevealApiKey={onRevealApiKey}
			onRevealWebSearchApiKey={onRevealWebSearchApiKey}
			onRevealConnectorCredential={onRevealConnectorCredential}
			onRevealTelemetryCredential={onRevealTelemetryCredential}
			onStartConnectorOAuth={onStartConnectorOAuth}
			onDisconnectConnectorOAuth={onDisconnectConnectorOAuth}
			telemetry={telemetry}
			telemetryLoading={telemetryLoading}
			telemetryLoadError={telemetryLoadError}
			onSaveTelemetry={onSaveTelemetry}
			fetchingProfileId={fetchingProfileId}
			lastFetch={lastFetch}
			onRetry={onRetry}
		/>
	);
}

function toConnectorInput(snapshot: DesktopConnectorConfigSnapshot): DesktopConnectorConfigInput {
	return {
		connectors: snapshot.connectors.map((connector) => ({
			id: connector.id,
			enabled: connector.enabled,
			credentials: {},
		})),
		policy: {
			default: snapshot.policy.default,
			actions: { ...snapshot.policy.actions },
		},
	};
}

function toWebSearchInput(snapshot: DesktopWebSearchConfigSnapshot): DesktopWebSearchConfigInput {
	return {
		providers: snapshot.providers.map((provider) => ({
			id: provider.id,
			enabled: provider.enabled,
			...(provider.order === undefined ? {} : { order: provider.order }),
		})),
		fetch: { jina: {} },
	};
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
	const intl = useIntl();
	const SettingsIcon = useIcon("settings");

	return (
		<div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
			<SettingsIcon className="mb-3 size-5 text-muted-foreground" />
			<p className="text-[14px] font-semibold">
				{intl.formatMessage(loading ? desktopMessages.settingsLoading : desktopMessages.settingsUnavailable)}
			</p>
			{error ? (
				<Button type="button" variant="tertiary" className="mt-4" onClick={onRetry}>
					{intl.formatMessage(desktopMessages.settingsRetry)}
				</Button>
			) : null}
		</div>
	);
}

interface ProviderConfigFormProps {
	readonly snapshot: DesktopProviderConfigSnapshot;
	readonly onRetry: () => void;
	readonly onSave: (input: DesktopProviderConfigInput) => Promise<DesktopProviderConfigSnapshot>;
	readonly onFetchModels: (profileId: string) => Promise<DesktopProviderFetchModelsResult>;
	readonly onRevealApiKey: (profileId: string) => Promise<string>;
	readonly onRevealWebSearchApiKey: (credentialId: DesktopWebSearchCredentialId) => Promise<string>;
	readonly onRevealConnectorCredential: (connectorId: string, credentialKey: string) => Promise<string>;
	readonly onRevealTelemetryCredential: (credentialId: DesktopTelemetryCredentialId) => Promise<string>;
	readonly onStartConnectorOAuth: (connectorId: string) => Promise<DesktopConnectorOAuthStartResult>;
	readonly onDisconnectConnectorOAuth: (connectorId: string) => Promise<DesktopProviderConfigSnapshot>;
	readonly telemetry?: DesktopTelemetrySettingsSnapshot;
	readonly telemetryLoading: boolean;
	readonly telemetryLoadError: boolean;
	readonly onSaveTelemetry: (input: DesktopTelemetrySettingsInput) => Promise<DesktopTelemetrySettingsSnapshot>;
	readonly fetchingProfileId?: string;
	readonly lastFetch?: DesktopProviderFetchModelsResult;
}

function ProviderConfigForm({
	snapshot,
	onRetry,
	onSave,
	onFetchModels,
	onRevealApiKey,
	onRevealWebSearchApiKey,
	onRevealConnectorCredential,
	onRevealTelemetryCredential,
	onStartConnectorOAuth,
	onDisconnectConnectorOAuth,
	telemetry,
	telemetryLoading,
	telemetryLoadError,
	onSaveTelemetry,
	fetchingProfileId,
	lastFetch,
}: ProviderConfigFormProps) {
	const intl = useIntl();
	const [category, setCategory] = useState<SettingsCategory>("general");
	const [profiles, setProfiles] = useState<ProfileDraft[]>(() => snapshot.profiles.map(toProfileDraft));
	const [selectedProfileId, setSelectedProfileId] = useState(snapshot.profiles[0]?.id ?? "");
	const [maxIterations, setMaxIterations] = useState(snapshot.maxIterations?.toString() ?? "");
	const [reasoningEffort, setReasoningEffort] = useState(snapshot.reasoningEffort ?? "");
	const [connector, setConnector] = useState<DesktopConnectorConfigInput>(() => toConnectorInput(snapshot.connector));
	const [webSearch, setWebSearch] = useState<DesktopWebSearchConfigInput>(() => toWebSearchInput(snapshot.webSearch));
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const [dirty, setDirty] = useState(false);
	const canSave =
		profiles.length > 0 ||
		snapshot.profiles.length > 0 ||
		connector.connectors.length > 0 ||
		webSearch.providers.length > 0;
	const contentClassName = cn(
		"mx-auto min-h-0 w-full max-w-3xl flex-1",
		category === "connector" ? "flex overflow-hidden" : "overflow-y-auto",
	);
	const providerCategory = category !== "advanced";

	const submit = async () => {
		const validationError = validateProviderDraft(profiles, maxIterations);
		if (validationError) {
			setError(formatProviderValidationError(validationError, intl));
			return;
		}
		if (
			webSearch.providers.some((provider) => {
				const saved = snapshot.webSearch.providers.find((candidate) => candidate.id === provider.id);
				return (
					provider.enabled &&
					!provider.apiKey?.trim() &&
					(!saved?.credentialConfigured || provider.clearApiKey === true)
				);
			})
		) {
			setError(intl.formatMessage(desktopMessages.settingsWebSearchApiKeyRequired));
			return;
		}
		setSaving(true);
		setError(undefined);
		try {
			const savedSnapshot = await onSave({
				revision: snapshot.revision,
				...(maxIterations ? { maxIterations: Number(maxIterations) } : {}),
				...(reasoningEffort ? { reasoningEffort: reasoningEffort as "low" | "medium" | "high" } : {}),
				connector,
				webSearch,
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
			setWebSearch(toWebSearchInput(savedSnapshot.webSearch));
			setDirty(false);
		} catch (_cause) {
			setError(intl.formatMessage(desktopMessages.settingsProviderSaveError));
		} finally {
			setSaving(false);
		}
	};

	return (
		<form
			className="flex h-full min-h-0 flex-1 bg-muted-hover"
			onSubmit={(event) => {
				event.preventDefault();
				if (providerCategory) void submit();
			}}
		>
			<SettingsSidebar category={category} onCategoryChange={(nextCategory) => setCategory(nextCategory)} />

			<div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-surface-primary shadow-surface-1 my-2 mr-2">
				<h1 className="mx-auto w-full max-w-3xl shrink-0 px-8 pt-7 text-[22px] font-medium tracking-tight">
					{intl.formatMessage(settingsCategories[category].label)}
				</h1>
				<div className={contentClassName}>
					{category === "general" ? (
						<GeneralSettings
							maxIterations={maxIterations}
							reasoningEffort={reasoningEffort}
							onMaxIterationsChange={(value) => {
								setMaxIterations(value);
								setDirty(true);
							}}
							onReasoningEffortChange={(value) => {
								setReasoningEffort(value);
								setDirty(true);
							}}
						/>
					) : category === "providers" ? (
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
									setError(intl.formatMessage(desktopMessages.settingsSaveBeforeFetchModels));
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
								} catch (_cause) {
									setError(intl.formatMessage(desktopMessages.settingsFetchModelsError));
								}
							}}
							onRevealApiKey={onRevealApiKey}
							fetchingProfileId={fetchingProfileId}
							lastFetch={lastFetch}
						/>
					) : category === "web-search" ? (
						<WebSearchSettings
							snapshot={snapshot.webSearch}
							value={webSearch}
							onRevealApiKey={onRevealWebSearchApiKey}
							onChange={(value) => {
								setWebSearch(value);
								setDirty(true);
							}}
						/>
					) : category === "connector" ? (
						<ConnectorSettings
							snapshot={snapshot.connector}
							value={connector}
							onStartOAuth={onStartConnectorOAuth}
							onDisconnectOAuth={onDisconnectConnectorOAuth}
							onRevealCredential={onRevealConnectorCredential}
							onChange={(value) => {
								setConnector(value);
								setDirty(true);
							}}
						/>
					) : (
						<ObservabilitySettings
							snapshot={telemetry}
							loading={telemetryLoading}
							loadError={telemetryLoadError}
							onRetry={onRetry}
							onSave={onSaveTelemetry}
							onRevealCredential={onRevealTelemetryCredential}
						/>
					)}
				</div>

				{providerCategory ? (
					<div className="flex shrink-0 items-center justify-end gap-3 border-t border-border px-8 py-3">
						{error ? (
							<p className="mr-auto max-w-115 text-[12px] leading-relaxed text-destructive" role="alert">
								{error}
							</p>
						) : dirty ? (
							<p className="mr-auto flex items-center gap-1.5 text-[12px] text-muted-foreground" role="status">
								<span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
								{intl.formatMessage(desktopMessages.settingsUnsavedChanges)}
							</p>
						) : null}
						<Button type="submit" loading={saving} disabled={!canSave}>
							{intl.formatMessage(desktopMessages.settingsSave)}
						</Button>
					</div>
				) : null}
			</div>
		</form>
	);
}

function SettingsSidebar({
	category,
	onCategoryChange,
}: {
	readonly category: SettingsCategory;
	readonly onCategoryChange: (category: SettingsCategory) => void;
}) {
	const intl = useIntl();
	const icons = useIcons();
	const categoryIds = Object.keys(settingsCategories) as SettingsCategory[];

	return (
		<aside className="flex w-48 shrink-0 flex-col">
			<h2 className="px-4 pt-5 pb-2 text-[12px] font-medium text-muted-foreground">
				{intl.formatMessage(desktopMessages.settingsTitle)}
			</h2>
			<nav
				className="flex min-h-0 flex-1 flex-col gap-0.5 px-2"
				aria-label={intl.formatMessage(desktopMessages.settingsTitle)}
			>
				{categoryIds.map((id) => {
					const item = settingsCategories[id];
					const isActive = category === id;
					const itemClassName = cn(
						"h-8 w-full justify-start gap-2 rounded-lg px-2 text-left text-[14px] text-foreground",
						{ "bg-active font-medium": isActive },
					);
					return (
						<Button
							type="button"
							variant="ghost"
							size="md"
							leadingIcon={icons[item.icon]}
							key={id}
							onClick={() => onCategoryChange(id)}
							aria-current={isActive ? "page" : undefined}
							className={itemClassName}
						>
							{intl.formatMessage(item.label)}
						</Button>
					);
				})}
			</nav>
		</aside>
	);
}

function formatProviderValidationError(error: ProviderDraftValidationError, intl: ReturnType<typeof useIntl>): string {
	switch (error.kind) {
		case "invalid-max-iterations":
			return intl.formatMessage(desktopMessages.settingsPositiveMaxIterations);
		case "provider-name-required":
			return intl.formatMessage(desktopMessages.settingsProviderNameRequired);
		case "profile-id-invalid":
			return intl.formatMessage(desktopMessages.settingsProfileIdInvalid, { id: error.id });
		case "profile-id-duplicate":
			return intl.formatMessage(desktopMessages.settingsProfileIdDuplicate, { id: error.id });
		case "provider-api-key-required":
			return intl.formatMessage(desktopMessages.settingsProviderApiKeyRequired, { name: error.name });
	}
}
