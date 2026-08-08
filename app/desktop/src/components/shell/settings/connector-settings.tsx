import type { ReactNode } from "react";
import type {
	DesktopConnectorConfigInput,
	DesktopConnectorConfigSnapshot,
	DesktopConnectorProvider,
} from "../../../../shared/desktop-rpc";
import { Input } from "../../ui/input";
import { Switch } from "../../ui/switch";

interface ConnectorSettingsProps {
	readonly snapshot: DesktopConnectorConfigSnapshot;
	readonly value: DesktopConnectorConfigInput;
	readonly onChange: (value: DesktopConnectorConfigInput) => void;
}

export function ConnectorSettings({ snapshot, value, onChange }: ConnectorSettingsProps) {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-6">
			<div className="flex items-center justify-between gap-6">
				<div>
					<h2 className="text-sm font-semibold">Connector</h2>
				</div>
				<Switch
					label="Enable Connector"
					checked={value.enabled}
					onToggle={() => onChange({ ...value, enabled: !value.enabled })}
				/>
			</div>

			<div className="mt-6 flex flex-col gap-6">
				{snapshot.providers.map((provider) => (
					<ConnectorProviderFields
						key={provider.id}
						provider={provider}
						value={value.providers.find((candidate) => candidate.id === provider.id)}
						onChange={(next) =>
							onChange({
								...value,
								providers: value.providers.some((candidate) => candidate.id === next.id)
									? value.providers.map((candidate) => (candidate.id === next.id ? next : candidate))
									: [...value.providers, next],
							})
						}
					/>
				))}
			</div>
		</div>
	);
}

function ConnectorProviderFields({
	provider,
	value,
	onChange,
}: {
	readonly provider: DesktopConnectorProvider;
	readonly value?: DesktopConnectorConfigInput["providers"][number];
	readonly onChange: (value: DesktopConnectorConfigInput["providers"][number]) => void;
}) {
	const current = value ?? {
		id: provider.id,
		enabled: provider.enabled,
		defaultConnection: provider.defaultConnection,
		credentials: {},
	};
	return (
		<section className="flex flex-col gap-4 border-t border-border/60 pt-5 first:border-t-0 first:pt-0">
			<div className="flex items-center justify-between gap-4">
				<div>
					<h3 className="text-[14px] font-semibold">{provider.name}</h3>
					<p className="mt-1 text-[12px] text-muted-foreground">{provider.authTypes.join(" / ")}</p>
				</div>
				<Switch
					label={`Enable ${provider.name}`}
					checked={current.enabled}
					onToggle={() => onChange({ ...current, enabled: !current.enabled })}
				/>
			</div>
			<div className="grid grid-cols-2 gap-3">
				<Field label="Connection alias">
					<Input
						value={current.defaultConnection}
						onChange={(event) => onChange({ ...current, defaultConnection: event.target.value })}
						aria-label={`${provider.name} connection alias`}
						autoComplete="off"
					/>
				</Field>
			</div>
			<div className="grid grid-cols-2 gap-3">
				{provider.credentials.map((credential) => (
					<Field key={credential.key} label={credential.key}>
						<Input
							type="password"
							value={current.credentials[credential.key] ?? ""}
							placeholder={credential.configured ? credential.mask : "Not configured"}
							onChange={(event) =>
								onChange({
									...current,
									credentials: { ...current.credentials, [credential.key]: event.target.value },
								})
							}
							aria-label={`${provider.name} ${credential.key}`}
							autoComplete="new-password"
							spellCheck={false}
						/>
					</Field>
				))}
			</div>
		</section>
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
