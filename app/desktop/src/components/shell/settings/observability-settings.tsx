import { type ReactNode, useEffect, useState } from "react";
import { useIcon } from "@/lib/icon-context";
import type { DesktopTelemetrySettingsInput, DesktopTelemetrySettingsSnapshot } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Switch } from "../../ui/switch";

interface ObservabilitySettingsProps {
	readonly snapshot?: DesktopTelemetrySettingsSnapshot;
	readonly loading: boolean;
	readonly loadError: boolean;
	readonly onRetry: () => void;
	readonly onSave: (input: DesktopTelemetrySettingsInput) => Promise<DesktopTelemetrySettingsSnapshot>;
}

export function ObservabilitySettings({ snapshot, loading, loadError, onRetry, onSave }: ObservabilitySettingsProps) {
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
			setError("Enter the Langfuse OTLP endpoint before enabling telemetry.");
			return;
		}
		if (!clearCredentials && replacingCredentials && (!normalizedPublicKey || !normalizedSecretKey)) {
			setError("Enter both the Langfuse public key and secret key.");
			return;
		}
		if (!clearCredentials && nextEnabled && !snapshot.credential.configured && !replacingCredentials) {
			setError("Enter a Langfuse public key and secret key before enabling telemetry.");
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
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Observability settings could not be saved.");
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
						{loading ? "Loading observability settings..." : "Observability settings are unavailable"}
					</p>
					{loadError ? (
						<Button type="button" variant="tertiary" className="mt-4" onClick={onRetry}>
							Retry
						</Button>
					) : null}
				</div>
			</div>
		);
	}

	const formDisabled = saving || snapshot.environmentOverride;
	const clearLabel = enabled ? "Disable and clear keys" : "Clear saved keys";
	const credentialStatus = snapshot.credential.configured
		? `Stored: ${snapshot.credential.publicKeyMask ?? "Public key"} and ${snapshot.credential.secretKeyMask ?? "Secret key"}`
		: "No Langfuse key pair is stored.";

	return (
		<div className="min-h-0 px-8 py-6">
			<div className="flex items-start justify-between gap-6 border-b border-border/55 pb-5">
				<div className="max-w-105">
					<h2 className="text-base font-semibold">Observability</h2>
					<p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
						Send coding-agent telemetry to Langfuse through OTLP. Telemetry stays disabled until you enable it.
					</p>
				</div>
				<Switch
					label="Enable telemetry"
					checked={enabled}
					disabled={formDisabled}
					onToggle={() => setEnabled((current) => !current)}
				/>
			</div>

			{snapshot.environmentOverride ? (
				<div className="flex gap-3 border-b border-border/55 py-5" role="status">
					<LockIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
					<p className="text-[13px] leading-relaxed text-muted-foreground">
						This Runtime Host is configured by <code>JAI_TELEMETRY_*</code> environment variables. Local settings
						are read-only while that override is present.
					</p>
				</div>
			) : null}

			<div className="divide-y divide-border/55">
				<SettingsField
					label="Langfuse OTLP endpoint"
					description="Use the /api/public/otel endpoint for your Langfuse Cloud or self-hosted instance."
				>
					<Input
						type="url"
						value={endpoint}
						disabled={formDisabled}
						onChange={(event) => setEndpoint(event.target.value)}
						placeholder="https://your-langfuse.example/api/public/otel"
						aria-label="Langfuse OTLP endpoint"
						autoComplete="off"
						spellCheck={false}
					/>
				</SettingsField>

				<SettingsField
					label="Langfuse public key"
					description="Leave both key fields empty to keep the stored key pair."
				>
					<Input
						type="password"
						value={publicKey}
						disabled={formDisabled}
						onChange={(event) => setPublicKey(event.target.value)}
						placeholder={snapshot.credential.publicKeyMask ?? "pk-lf-..."}
						aria-label="Langfuse public key"
						autoComplete="off"
						spellCheck={false}
					/>
				</SettingsField>

				<SettingsField
					label="Langfuse secret key"
					description="Keys are stored in the local Runtime Host database, never in settings.json."
				>
					<Input
						type="password"
						value={secretKey}
						disabled={formDisabled}
						onChange={(event) => setSecretKey(event.target.value)}
						placeholder={snapshot.credential.secretKeyMask ?? "sk-lf-..."}
						aria-label="Langfuse secret key"
						autoComplete="off"
						spellCheck={false}
					/>
				</SettingsField>
			</div>

			<div className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-5">
				<p className="mr-auto text-[12px] text-muted-foreground" role="status">
					{credentialStatus}
				</p>
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
					Save
				</Button>
			</div>
			{snapshot.configurationError || error ? (
				<p className="mt-4 max-w-125 text-[12px] leading-relaxed text-destructive" role="alert">
					{error ?? snapshot.configurationError}
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
