import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { desktop } from "@/lib/desktop";
import { desktopQueryKeys } from "@/lib/desktop-query";
import { useIcon } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type {
	DesktopConnectorConfigInput,
	DesktopConnectorConfigSnapshot,
	DesktopConnectorCredential,
	DesktopConnectorProvider,
} from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";

type ConnectorFilter = "all" | "connected" | "not-connected";

const OAUTH_STATUS_POLL_INTERVAL_MS = 1_000;

interface ConnectorSettingsProps {
	readonly snapshot: DesktopConnectorConfigSnapshot;
	readonly value: DesktopConnectorConfigInput;
	readonly onChange: (value: DesktopConnectorConfigInput) => void;
	readonly onStartOAuth: (providerId: string) => Promise<unknown>;
	readonly onDisconnectOAuth: (providerId: string) => Promise<unknown>;
}

export function ConnectorSettings({
	snapshot,
	value,
	onChange,
	onStartOAuth,
	onDisconnectOAuth,
}: ConnectorSettingsProps) {
	const [selectedProviderId, setSelectedProviderId] = useState<string>();

	const updateProvider = (next: DesktopConnectorConfigInput["providers"][number]) => {
		onChange({
			...value,
			providers: value.providers.some((candidate) => candidate.id === next.id)
				? value.providers.map((candidate) => (candidate.id === next.id ? next : candidate))
				: [...value.providers, next],
		});
	};

	const selectedProvider = snapshot.providers.find((provider) => provider.id === selectedProviderId);
	if (selectedProvider) {
		return (
			<ConnectorDetailPage
				provider={selectedProvider}
				value={resolveProviderValue(value, selectedProvider)}
				onChange={updateProvider}
				onStartOAuth={onStartOAuth}
				onDisconnectOAuth={onDisconnectOAuth}
				onBack={() => setSelectedProviderId(undefined)}
			/>
		);
	}

	return (
		<ConnectorCatalogPage
			snapshot={snapshot}
			value={value}
			onSelect={setSelectedProviderId}
			onStartOAuth={onStartOAuth}
		/>
	);
}

function ConnectorCatalogPage({
	snapshot,
	value,
	onSelect,
	onStartOAuth,
}: {
	readonly snapshot: DesktopConnectorConfigSnapshot;
	readonly value: DesktopConnectorConfigInput;
	readonly onSelect: (providerId: string) => void;
	readonly onStartOAuth: (providerId: string) => Promise<unknown>;
}) {
	const [filter, setFilter] = useState<ConnectorFilter>("all");
	const visibleProviders = snapshot.providers.filter((provider) => {
		const connected = isProviderConnected(provider, resolveProviderValue(value, provider));
		return filter === "all" || (filter === "connected" ? connected : !connected);
	});
	const emptyStateCopy = filter === "connected" ? "No connectors are connected yet." : "Every connector is set up.";

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
			<div className="px-6 pb-4 pt-6">
				<h2 className="text-base font-semibold tracking-[-0.02em]">Connectors</h2>
			</div>
			<nav className="flex gap-1 px-6" aria-label="Connector filters">
				{[
					{ id: "all" as const, label: "All" },
					{ id: "connected" as const, label: "Connected" },
					{
						id: "not-connected" as const,
						label: "Not connected",
					},
				].map((item) => (
					<Button
						key={item.id}
						type="button"
						variant="ghost"
						size="sm"
						active={filter === item.id}
						className={cn(
							"h-8 rounded-lg px-3",
							filter === item.id ? "font-semibold text-foreground" : "text-muted-foreground",
						)}
						onClick={() => setFilter(item.id)}
						aria-pressed={filter === item.id}
					>
						{item.label}
					</Button>
				))}
			</nav>

			<div className="px-6 pb-8">
				{visibleProviders.length > 0 ? (
					<table className="w-full table-fixed border-collapse" aria-label="Available connectors">
						<thead>
							<tr className="border-b border-border/55">
								<th scope="col" className="w-[58%] py-4 text-left text-xs font-semibold text-foreground">
									Connector
								</th>
								<th scope="col" className="w-[22%] py-4 text-left text-xs font-semibold text-foreground">
									Type
								</th>
								<th scope="col" className="w-[20%] py-4 text-center text-xs font-semibold text-foreground">
									Status
								</th>
							</tr>
						</thead>
						<tbody>
							{visibleProviders.map((provider) => {
								const current = resolveProviderValue(value, provider);
								return (
									<ConnectorTableRow
										key={provider.id}
										provider={provider}
										connected={isProviderConnected(provider, current)}
										onSelect={() => onSelect(provider.id)}
										onStartOAuth={onStartOAuth}
									/>
								);
							})}
						</tbody>
					</table>
				) : (
					<p className="py-10 text-center text-[13px] text-muted-foreground">{emptyStateCopy}</p>
				)}
			</div>
		</div>
	);
}

function ConnectorTableRow({
	provider,
	connected,
	onSelect,
	onStartOAuth,
}: {
	readonly provider: DesktopConnectorProvider;
	readonly connected: boolean;
	readonly onSelect: () => void;
	readonly onStartOAuth: (providerId: string) => Promise<unknown>;
}) {
	const CheckIcon = useIcon("check");
	const authLabel = getAuthLabel(provider.authTypes);
	const isOAuth = provider.authTypes.includes("oauth");
	const [authorizing, setAuthorizing] = useState(false);
	const [oauthError, setOAuthError] = useState<string>();

	useEffect(() => {
		if (!authorizing) return;
		return window.desktopRpc.onAgentEvent((envelope) => {
			const event = envelope.event;
			if (event.type !== "connector_oauth_completed" && event.type !== "connector_oauth_failed") return;
			if (event.providerId !== provider.id) return;
			setAuthorizing(false);
			if (event.type === "connector_oauth_failed") setOAuthError(event.message);
		});
	}, [authorizing, provider.id]);

	const startOAuth = async () => {
		setAuthorizing(true);
		setOAuthError(undefined);
		try {
			await onStartOAuth(provider.id);
		} catch (cause) {
			setAuthorizing(false);
			setOAuthError(cause instanceof Error ? cause.message : "Unable to start OAuth authorization.");
		}
	};

	return (
		<tr
			tabIndex={0}
			className="cursor-pointer border-b border-border/55 transition-colors duration-80 hover:bg-hover focus-visible:bg-hover last:border-b-0"
			onClick={onSelect}
			onKeyDown={(event) => {
				if (event.target !== event.currentTarget) return;
				if (event.key !== "Enter" && event.key !== " ") return;
				event.preventDefault();
				onSelect();
			}}
		>
			<td className="py-2 pr-4">
				<div className="flex min-w-0 items-center gap-3">
					<span className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-border/60 bg-white p-1">
						<ConnectorBrandLogo provider={provider} size={23} />
					</span>
					<p className="truncate text-[14px] font-semibold tracking-[-0.015em] text-foreground">{provider.name}</p>
				</div>
			</td>
			<td className="py-2 pr-4 text-[13px] text-muted-foreground">{authLabel}</td>
			<td className="py-2 text-center">
				{connected ? (
					<span className="inline-flex text-primary" role="status">
						<CheckIcon size={18} strokeWidth={1.8} />
						<span className="sr-only">Connected</span>
					</span>
				) : isOAuth ? (
					<Button
						type="button"
						variant="tertiary"
						size="sm"
						loading={authorizing}
						title={oauthError}
						onClick={(event) => {
							event.stopPropagation();
							void startOAuth();
						}}
					>
						{oauthError ? "Retry" : "Connect"}
					</Button>
				) : (
					<Button
						type="button"
						variant="tertiary"
						size="sm"
						onClick={(event) => {
							event.stopPropagation();
							onSelect();
						}}
					>
						Configure
					</Button>
				)}
			</td>
		</tr>
	);
}

function ConnectorDetailPage({
	provider,
	value,
	onChange,
	onBack,
	onStartOAuth,
	onDisconnectOAuth,
}: {
	readonly provider: DesktopConnectorProvider;
	readonly value: DesktopConnectorConfigInput["providers"][number];
	readonly onChange: (value: DesktopConnectorConfigInput["providers"][number]) => void;
	readonly onBack: () => void;
	readonly onStartOAuth: (providerId: string) => Promise<unknown>;
	readonly onDisconnectOAuth: (providerId: string) => Promise<unknown>;
}) {
	const ArrowLeftIcon = useIcon("arrow-left");
	const isOAuth = provider.authTypes.includes("oauth");
	const connected = isOAuth ? provider.oauth?.connected === true : isProviderConnected(provider, value);
	const authLabel = getAuthLabel(provider.authTypes);
	const showAuthLabel = !provider.authTypes.includes("api_key");
	const [authorizing, setAuthorizing] = useState(false);
	const [disconnecting, setDisconnecting] = useState(false);
	const [oauthError, setOAuthError] = useState<string>();

	useEffect(() => {
		if (connected) setAuthorizing(false);
	}, [connected]);

	useEffect(() => {
		return window.desktopRpc.onAgentEvent((envelope) => {
			if (envelope.event.type !== "connector_oauth_completed" && envelope.event.type !== "connector_oauth_failed")
				return;
			if (envelope.event.providerId !== provider.id) return;
			setAuthorizing(false);
			setOAuthError(envelope.event.type === "connector_oauth_failed" ? envelope.event.message : undefined);
		});
	}, [provider.id]);

	useQuery({
		queryKey: desktopQueryKeys.providerConfig,
		queryFn: () => desktop.provider.get(),
		enabled: authorizing,
		refetchInterval: authorizing ? OAUTH_STATUS_POLL_INTERVAL_MS : false,
		refetchIntervalInBackground: true,
		retry: false,
	});

	const startOAuth = async () => {
		setAuthorizing(true);
		setOAuthError(undefined);
		try {
			await onStartOAuth(provider.id);
		} catch (cause) {
			setAuthorizing(false);
			setOAuthError(cause instanceof Error ? cause.message : "Unable to start OAuth authorization.");
		}
	};

	const disconnectOAuth = async () => {
		setDisconnecting(true);
		setOAuthError(undefined);
		try {
			await onDisconnectOAuth(provider.id);
		} catch (cause) {
			setOAuthError(cause instanceof Error ? cause.message : "Unable to disconnect this account.");
		} finally {
			setDisconnecting(false);
		}
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
			<header className="flex items-center gap-2 px-6 pt-4">
				<Button
					type="button"
					variant="ghost"
					size="md"
					leadingIcon={ArrowLeftIcon}
					className="-ml-2 rounded-lg px-2.5"
					onClick={onBack}
				>
					Connectors
				</Button>
			</header>

			<main className="px-6 pb-10 pt-2">
				<div className="flex items-start justify-between gap-6">
					<div className="min-w-0">
						<div className="flex min-w-0 items-center gap-4">
							<span className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-border/60 bg-white p-1">
								<ConnectorBrandLogo provider={provider} size={25} />
							</span>
							<h2 className="min-w-0 truncate text-[18px] font-semibold tracking-[-0.025em]">{provider.name}</h2>
						</div>
						{showAuthLabel ? <p className="mt-1 pl-10 text-[13px] text-muted-foreground">{authLabel}</p> : null}
					</div>
					<div className="flex shrink-0 items-center gap-3">
						{connected && isOAuth ? (
							<Button
								type="button"
								variant="tertiary"
								size="lg"
								loading={disconnecting}
								onClick={() => void disconnectOAuth()}
							>
								Disconnect
							</Button>
						) : null}
					</div>
				</div>

				<p className="mt-3 max-w-3xl text-[14px] leading-relaxed text-muted-foreground">
					{provider.description ?? "Configure this connector so your agent can use its tools."}
				</p>

				{isOAuth ? (
					<section className="mt-5 border-t border-border/55 pt-6">
						<h3 className="text-[14px] font-semibold">Account access</h3>
						<p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
							Connect your account in the browser. Your provider permissions stay attached to this connection.
						</p>
						{connected ? (
							<p className="mt-5 text-[13px] text-primary">Connected to your {provider.name} account.</p>
						) : (
							<>
								<Button
									type="button"
									variant="primary"
									size="lg"
									className="mt-5"
									loading={authorizing}
									disabled={authorizing}
									onClick={() => void startOAuth()}
								>
									{authorizing ? "Finish in browser" : "Connect"}
								</Button>
								{authorizing ? (
									<p className="mt-3 text-[12px] text-muted-foreground" role="status" aria-live="polite">
										Waiting for approval in your browser…
									</p>
								) : null}
							</>
						)}
						{oauthError ? (
							<p className="mt-3 text-[12px] leading-relaxed text-destructive" role="alert">
								{oauthError}
							</p>
						) : null}
					</section>
				) : (
					<CredentialSettings provider={provider} value={value} onChange={onChange} />
				)}
			</main>
		</div>
	);
}

function CredentialSettings({
	provider,
	value,
	onChange,
}: {
	readonly provider: DesktopConnectorProvider;
	readonly value: DesktopConnectorConfigInput["providers"][number];
	readonly onChange: (value: DesktopConnectorConfigInput["providers"][number]) => void;
}) {
	return (
		<div className="mt-5 border-t border-border/55 pt-6">
			<div>
				<h3 className="text-[14px] font-semibold">Credentials</h3>
				<p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
					Values are stored in your local settings and are only sent to this connector.
				</p>
				<div className="mt-5 grid max-w-3xl grid-cols-2 gap-x-5 gap-y-5">
					{provider.credentials.map((credential) => (
						<CredentialField
							key={credential.key}
							credential={credential}
							value={value.credentials[credential.key] ?? ""}
							onChange={(nextValue) =>
								onChange({
									...value,
									credentials: { ...value.credentials, [credential.key]: nextValue },
								})
							}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

function CredentialField({
	credential,
	value,
	onChange,
}: {
	readonly credential: DesktopConnectorCredential;
	readonly value: string;
	readonly onChange: (value: string) => void;
}) {
	const inputType = credential.kind === "secret" ? "password" : credential.kind === "url" ? "url" : "text";
	const placeholder = credential.configured ? credential.mask : credential.placeholder;

	return (
		<DetailField label={credential.label} description={credential.description}>
			<Input
				type={inputType}
				value={value}
				placeholder={placeholder}
				onChange={(event) => onChange(event.target.value)}
				aria-label={credential.label}
				autoComplete={credential.kind === "secret" ? "new-password" : "off"}
				spellCheck={false}
			/>
		</DetailField>
	);
}

function DetailField({
	label,
	description,
	children,
}: {
	readonly label: string;
	readonly description?: string;
	readonly children: ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1.5 text-[12px] font-medium text-foreground">
			<span>{label}</span>
			{children}
			{description ? (
				<span className="text-[11px] font-normal leading-relaxed text-muted-foreground">{description}</span>
			) : null}
		</div>
	);
}

function resolveProviderValue(
	value: DesktopConnectorConfigInput,
	provider: DesktopConnectorProvider,
): DesktopConnectorConfigInput["providers"][number] {
	return (
		value.providers.find((candidate) => candidate.id === provider.id) ?? {
			id: provider.id,
			enabled: provider.enabled,
			credentials: {},
		}
	);
}

function isProviderConnected(
	provider: DesktopConnectorProvider,
	value: DesktopConnectorConfigInput["providers"][number],
): boolean {
	if (provider.oauth) return provider.oauth.connected;
	if (provider.credentials.length === 0) return false;
	return provider.credentials.every((credential) => {
		return credential.configured || Boolean(value.credentials[credential.key]?.trim());
	});
}

function useProviderIcon(provider: DesktopConnectorProvider) {
	const apiKeyIcon = useIcon("key");
	const oauthIcon = useIcon("globe");
	const customIcon = useIcon("link");
	return provider.authTypes.includes("oauth")
		? oauthIcon
		: provider.authTypes.includes("api_key")
			? apiKeyIcon
			: customIcon;
}

function ConnectorBrandLogo({
	provider,
	size,
}: {
	readonly provider: DesktopConnectorProvider;
	readonly size: number;
}) {
	const ProviderIcon = useProviderIcon(provider);
	const [imageFailed, setImageFailed] = useState(false);
	if (!provider.iconUrl || imageFailed) return <ProviderIcon size={size} strokeWidth={1.7} />;
	return (
		<img
			src={provider.iconUrl}
			alt=""
			width={size}
			height={size}
			className="size-auto max-h-full max-w-full object-contain"
			referrerPolicy="no-referrer"
			onError={() => setImageFailed(true)}
		/>
	);
}

function getAuthLabel(authTypes: readonly string[]): string {
	const authLabels: Record<string, string> = {
		oauth: "OAuth",
		api_key: "API key",
		custom_credential: "Custom credentials",
	};
	return authTypes.map((authType) => authLabels[authType] ?? authType).join(" · ");
}
