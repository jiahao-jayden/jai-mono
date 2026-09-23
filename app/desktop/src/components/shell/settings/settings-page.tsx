import { cn } from "cn";
import { type CSSProperties, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcon } from "@/lib/icon-context";
import type {
	DesktopConnectorConfigInput,
	DesktopConnectorConfigSnapshot,
	DesktopConnectorOAuthStartResult,
	DesktopMcpSettingsInput,
	DesktopMcpSettingsSnapshot,
	DesktopMcpStatus,
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
import { DESKTOP_TOP_BAR_HEIGHT_CLASS } from "../desktop-chrome";
import { ArchivedChatsSettings } from "./archived-chats-settings";
import { ConnectorSettings } from "./connector-settings";
import { GeneralSettings } from "./general-settings";
import { LogsSettings } from "./logs-settings";
import { McpSettings } from "./mcp-settings";
import { ObservabilitySettings } from "./observability-settings";
import { ProfileSettings } from "./profile-settings";
import {
	type ProfileDraft,
	type ProviderDraftValidationError,
	toProfileDraft,
	validateProviderDraft,
} from "./provider-settings-types";
import { ProvidersSettings } from "./providers-settings";
import { type SettingsCategory, settingsCategories } from "./settings-navigation";
import { WebSearchSettings } from "./web-search-settings";

const windowDragClassName = cn("absolute inset-x-0 top-0 z-10", DESKTOP_TOP_BAR_HEIGHT_CLASS);
const windowDragStyle = { WebkitAppRegion: "drag" } as CSSProperties;

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
	readonly mcp?: DesktopMcpSettingsSnapshot;
	readonly mcpLoading: boolean;
	readonly mcpLoadError: boolean;
	readonly onSaveMcp: (input: DesktopMcpSettingsInput) => Promise<DesktopMcpSettingsSnapshot>;
	readonly onRefreshMcpStatus: () => Promise<DesktopMcpStatus>;
	readonly category: SettingsCategory;
	readonly onCategoryChange: (category: SettingsCategory) => void;
}

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
	mcp,
	mcpLoading,
	mcpLoadError,
	onSaveMcp,
	onRefreshMcpStatus,
	category,
	onCategoryChange,
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
			mcp={mcp}
			mcpLoading={mcpLoading}
			mcpLoadError={mcpLoadError}
			onSaveMcp={onSaveMcp}
			onRefreshMcpStatus={onRefreshMcpStatus}
			category={category}
			onCategoryChange={onCategoryChange}
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
			order: provider.order,
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
	readonly mcp?: DesktopMcpSettingsSnapshot;
	readonly mcpLoading: boolean;
	readonly mcpLoadError: boolean;
	readonly onSaveMcp: (input: DesktopMcpSettingsInput) => Promise<DesktopMcpSettingsSnapshot>;
	readonly onRefreshMcpStatus: () => Promise<DesktopMcpStatus>;
	readonly fetchingProfileId?: string;
	readonly lastFetch?: DesktopProviderFetchModelsResult;
	readonly category: SettingsCategory;
	readonly onCategoryChange: (category: SettingsCategory) => void;
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
	mcp,
	mcpLoading,
	mcpLoadError,
	onSaveMcp,
	onRefreshMcpStatus,
	fetchingProfileId,
	lastFetch,
	category,
	onCategoryChange,
}: ProviderConfigFormProps) {
	const intl = useIntl();
	const [profiles, setProfiles] = useState<ProfileDraft[]>(() => snapshot.profiles.map(toProfileDraft));
	const [selectedProfileId, setSelectedProfileId] = useState(snapshot.profiles[0]?.id ?? "");
	const [maxIterations, setMaxIterations] = useState(snapshot.maxIterations?.toString() ?? "");
	const [reasoningEffort, setReasoningEffort] = useState(snapshot.reasoningEffort ?? "");
	const [connector, setConnector] = useState<DesktopConnectorConfigInput>(() => toConnectorInput(snapshot.connector));
	const [webSearch, setWebSearch] = useState<DesktopWebSearchConfigInput>(() => toWebSearchInput(snapshot.webSearch));
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const [dirty, setDirty] = useState(false);
	useEffect(() => {
		if (dirty) return;
		setProfiles(snapshot.profiles.map(toProfileDraft));
		setSelectedProfileId((currentProfileId) =>
			snapshot.profiles.some((profile) => profile.id === currentProfileId)
				? currentProfileId
				: (snapshot.profiles[0]?.id ?? ""),
		);
	}, [dirty, snapshot.profiles]);
	const canSave =
		profiles.length > 0 ||
		snapshot.profiles.length > 0 ||
		connector.connectors.length > 0 ||
		webSearch.providers.length > 0;
	const contentClassName = cn(
		"mx-auto min-h-0 w-full max-w-3xl flex-1",
		category === "connector" ? "flex overflow-hidden" : "overflow-y-auto",
	);
	const providerCategory =
		category !== "advanced" &&
		category !== "mcp" &&
		category !== "archived" &&
		category !== "profile" &&
		category !== "logs";

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
				maxIterations: maxIterations ? Number(maxIterations) : undefined,
				reasoningEffort: reasoningEffort ? (reasoningEffort as "low" | "medium" | "high") : undefined,
				connector,
				webSearch,
				profiles: profiles.map(
					({ credentialConfigured: _configured, credentialMask: _mask, persistedId, ...profile }) => ({
						id: profile.id,
						previousId: persistedId && persistedId !== profile.id ? persistedId : undefined,
						name: profile.name,
						adapter: profile.adapter,
						baseURL: profile.baseURL,
						authentication: profile.authentication,
						apiKey: profile.apiKey || undefined,
						clearApiKey: profile.clearApiKey ? true : undefined,
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
			className="relative flex h-full min-h-0 flex-1 bg-background"
			onSubmit={(event) => {
				event.preventDefault();
				if (providerCategory) void submit();
			}}
		>
			<div aria-hidden="true" className={windowDragClassName} style={windowDragStyle} />
			<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
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
					) : category === "profile" ? (
						<ProfileSettings />
					) : category === "archived" ? (
						<ArchivedChatsSettings />
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
									onCategoryChange("providers");
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
					) : category === "logs" ? (
						<LogsSettings />
					) : category === "mcp" ? (
						<McpSettings
							snapshot={mcp}
							loading={mcpLoading}
							loadError={mcpLoadError}
							onRetry={onRetry}
							onSave={onSaveMcp}
							onRefreshStatus={onRefreshMcpStatus}
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
