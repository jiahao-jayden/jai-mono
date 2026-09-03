import { type ReactNode, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcon } from "@/lib/icon-context";
import type {
	DesktopTelemetryCredentialId,
	DesktopTelemetrySettingsInput,
	DesktopTelemetrySettingsSnapshot,
} from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Switch } from "../../ui/switch";
import { ApiKeyInput } from "./api-key-input";

interface ObservabilitySettingsProps {
	readonly snapshot?: DesktopTelemetrySettingsSnapshot;
	readonly loading: boolean;
	readonly loadError: boolean;
	readonly onRetry: () => void;
	readonly onSave: (input: DesktopTelemetrySettingsInput) => Promise<DesktopTelemetrySettingsSnapshot>;
	readonly onRevealCredential: (credentialId: DesktopTelemetryCredentialId) => Promise<string>;
}

export function ObservabilitySettings({
	snapshot,
	loading,
	loadError,
	onRetry,
	onSave,
	onRevealCredential,
}: ObservabilitySettingsProps) {
	const intl = useIntl();
	const LockIcon = useIcon("lock");
	const TrashIcon = useIcon("trash");
	const [enabled, setEnabled] = useState(snapshot?.enabled ?? false);
	const [endpoint, setEndpoint] = useState(snapshot?.endpoint ?? "");
	const [publicKey, setPublicKey] = useState("");
	const [secretKey, setSecretKey] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();

	useEffect(() => {
		if (!snapshot) return;
		setEnabled(snapshot.enabled);
		setEndpoint(snapshot.endpoint ?? "");
		setPublicKey("");
		setSecretKey("");
		setError(undefined);
	}, [snapshot]);

	const save = async (clearCredentials: boolean) => {
		if (!snapshot) return;
		const nextEnabled = clearCredentials ? false : enabled;
		const normalizedEndpoint = endpoint.trim();
		const normalizedPublicKey = publicKey.trim();
		const normalizedSecretKey = secretKey.trim();
		const replacingCredentials = Boolean(normalizedPublicKey || normalizedSecretKey);
		if (nextEnabled && !isHttpUrl(normalizedEndpoint)) {
			setError(intl.formatMessage(desktopMessages.settingsTelemetryEndpointRequired));
			return;
		}
		if (!clearCredentials && replacingCredentials && (!normalizedPublicKey || !normalizedSecretKey)) {
			setError(intl.formatMessage(desktopMessages.settingsTelemetryBothKeysRequired));
			return;
		}
		if (!clearCredentials && nextEnabled && !snapshot.credential.configured && !replacingCredentials) {
			setError(intl.formatMessage(desktopMessages.settingsTelemetryKeysRequired));
			return;
		}
		setSaving(true);
		setError(undefined);
		try {
			const saved = await onSave({
				credentialRevision: snapshot.credential.revision,
				enabled: nextEnabled,
				...(normalizedEndpoint ? { endpoint: normalizedEndpoint } : {}),
				exporter: "langfuse-otlp",
				policyRevision: snapshot.policyRevision,
				...(clearCredentials ? { clearCredentials: true } : {}),
				...(replacingCredentials ? { publicKey: normalizedPublicKey, secretKey: normalizedSecretKey } : {}),
			});
			setEnabled(saved.enabled);
			setEndpoint(saved.endpoint ?? "");
			setPublicKey("");
			setSecretKey("");
		} catch (_cause) {
			setError(intl.formatMessage(desktopMessages.settingsTelemetrySaveError));
		} finally {
			setSaving(false);
		}
	};

	if (!snapshot) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center px-8 py-10 text-center">
				<div className="max-w-80">
					<LockIcon className="mx-auto mb-3 size-5 text-muted-foreground" />
					<p className="text-[14px] font-semibold">
						{intl.formatMessage(loading ? desktopMessages.settingsLoading : desktopMessages.settingsUnavailable)}
					</p>
					{loadError ? (
						<Button type="button" variant="tertiary" className="mt-4" onClick={onRetry}>
							{intl.formatMessage(desktopMessages.settingsRetry)}
						</Button>
					) : null}
				</div>
			</div>
		);
	}

	const formDisabled = saving || snapshot.environmentOverride;
	const clearLabel = intl.formatMessage(
		enabled ? desktopMessages.settingsTelemetryDisableClear : desktopMessages.settingsTelemetryClear,
	);
	const credentialStatus = snapshot.credential.configured
		? intl.formatMessage(desktopMessages.settingsTelemetryStored, {
				publicKey:
					snapshot.credential.publicKeyMask ?? intl.formatMessage(desktopMessages.settingsTelemetryPublicKey),
				secretKey:
					snapshot.credential.secretKeyMask ?? intl.formatMessage(desktopMessages.settingsTelemetrySecretKey),
			})
		: undefined;
	const configurationError = snapshot.configurationError
		? intl.formatMessage(desktopMessages.settingsTelemetrySaveError)
		: error;

	return (
		<div className="min-h-0 px-8 py-6">
			<div className="flex items-start justify-between gap-6 border-b border-border/55 pb-5">
				<div className="max-w-105">
					<h2 className="text-base font-semibold">{intl.formatMessage(desktopMessages.settingsObservability)}</h2>
					<p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
						{intl.formatMessage(desktopMessages.settingsTelemetryDescription)}
					</p>
				</div>
				<Switch
					label={intl.formatMessage(desktopMessages.settingsTelemetryEnable)}
					checked={enabled}
					disabled={formDisabled}
					onToggle={() => setEnabled((current) => !current)}
				/>
			</div>

			{snapshot.environmentOverride ? (
				<div className="flex gap-3 border-b border-border/55 py-5" role="status">
					<LockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
					<p className="text-[13px] leading-relaxed text-muted-foreground">
						{intl.formatMessage(desktopMessages.settingsTelemetryOverride)}
					</p>
				</div>
			) : null}

			<div className="divide-y divide-border/55">
				<SettingsField
					label={intl.formatMessage(desktopMessages.settingsTelemetryEndpoint)}
					description={intl.formatMessage(desktopMessages.settingsTelemetryEndpointDescription)}
				>
					<Input
						type="url"
						value={endpoint}
						disabled={formDisabled}
						onChange={(event) => setEndpoint(event.target.value)}
						placeholder="https://your-langfuse.example/api/public/otel"
						aria-label={intl.formatMessage(desktopMessages.settingsTelemetryEndpoint)}
						autoComplete="off"
						spellCheck={false}
					/>
				</SettingsField>

				<SettingsField
					label={intl.formatMessage(desktopMessages.settingsTelemetryPublicKey)}
					description={intl.formatMessage(desktopMessages.settingsTelemetryPublicKeyDescription)}
				>
					<ApiKeyInput
						key={`telemetry-public:${snapshot.credential.publicKeyMask ?? "new"}`}
						value={publicKey}
						credentialConfigured={snapshot.credential.configured}
						credentialMask={snapshot.credential.publicKeyMask}
						disabled={formDisabled}
						onReveal={() => onRevealCredential("public")}
						onChange={setPublicKey}
						label={intl.formatMessage(desktopMessages.settingsTelemetryPublicKey)}
						showLabel={intl.formatMessage(desktopMessages.settingsProviderShowApiKey)}
						hideLabel={intl.formatMessage(desktopMessages.settingsProviderHideApiKey)}
						revealErrorLabel={intl.formatMessage(desktopMessages.settingsProviderRevealError)}
						replacementPlaceholder={intl.formatMessage(desktopMessages.settingsProviderReplacementKey)}
						enterPlaceholder="pk-lf-..."
					/>
				</SettingsField>

				<SettingsField
					label={intl.formatMessage(desktopMessages.settingsTelemetrySecretKey)}
					description={intl.formatMessage(desktopMessages.settingsTelemetrySecretKeyDescription)}
				>
					<ApiKeyInput
						key={`telemetry-secret:${snapshot.credential.secretKeyMask ?? "new"}`}
						value={secretKey}
						credentialConfigured={snapshot.credential.configured}
						credentialMask={snapshot.credential.secretKeyMask}
						disabled={formDisabled}
						onReveal={() => onRevealCredential("secret")}
						onChange={setSecretKey}
						label={intl.formatMessage(desktopMessages.settingsTelemetrySecretKey)}
						showLabel={intl.formatMessage(desktopMessages.settingsProviderShowApiKey)}
						hideLabel={intl.formatMessage(desktopMessages.settingsProviderHideApiKey)}
						revealErrorLabel={intl.formatMessage(desktopMessages.settingsProviderRevealError)}
						replacementPlaceholder={intl.formatMessage(desktopMessages.settingsProviderReplacementKey)}
						enterPlaceholder="sk-lf-..."
					/>
				</SettingsField>
			</div>

			<div className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-5">
				{credentialStatus ? (
					<p className="mr-auto text-[12px] text-muted-foreground" role="status">
						{credentialStatus}
					</p>
				) : null}
				{snapshot.credential.configured ? (
					<Button
						type="button"
						variant="tertiary"
						leadingIcon={TrashIcon}
						disabled={formDisabled}
						onClick={() => void save(true)}
					>
						{clearLabel}
					</Button>
				) : null}
				<Button type="button" loading={saving} disabled={formDisabled} onClick={() => void save(false)}>
					{intl.formatMessage(desktopMessages.settingsSave)}
				</Button>
			</div>
			{configurationError ? (
				<p className="mt-4 max-w-125 text-[12px] leading-relaxed text-destructive" role="alert">
					{configurationError}
				</p>
			) : null}
		</div>
	);
}

function SettingsField({
	label,
	description,
	children,
}: {
	readonly label: string;
	readonly description: string;
	readonly children: ReactNode;
}) {
	return (
		<div className="grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_minmax(220px,280px)] sm:items-start sm:gap-6">
			<div>
				<p className="text-[13.5px] font-medium">{label}</p>
				<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
			</div>
			<div>{children}</div>
		</div>
	);
}

function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}
