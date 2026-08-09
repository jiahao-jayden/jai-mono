import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { desktop } from "@/lib/desktop";
import { desktopQueryKeys } from "@/lib/desktop-query";
import { useIcon } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import type {
	DesktopConnector,
	DesktopConnectorConfigInput,
	DesktopConnectorConfigSnapshot,
	DesktopConnectorCredential,
	DesktopConnectorOAuthStartResult,
	DesktopConnectorPermission,
} from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "../../ui/select";
import { Tooltip } from "../../ui/tooltip";

type ConnectorFilter = "all" | "connected" | "not-connected";

const OAUTH_STATUS_POLL_INTERVAL_MS = 1_000;

interface ConnectorSettingsProps {
	readonly snapshot: DesktopConnectorConfigSnapshot;
	readonly value: DesktopConnectorConfigInput;
	readonly onChange: (value: DesktopConnectorConfigInput) => void;
	readonly onStartOAuth: (connectorId: string) => Promise<DesktopConnectorOAuthStartResult>;
	readonly onDisconnectOAuth: (connectorId: string) => Promise<unknown>;
}

export function ConnectorSettings({
	snapshot,
	value,
	onChange,
	onStartOAuth,
	onDisconnectOAuth,
}: ConnectorSettingsProps) {
	const [selectedConnectorId, setSelectedConnectorId] = useState<string>();

	const updateConnector = (next: DesktopConnectorConfigInput["connectors"][number]) => {
		onChange({
			...value,
			connectors: value.connectors.some((candidate) => candidate.id === next.id)
				? value.connectors.map((candidate) => (candidate.id === next.id ? next : candidate))
				: [...value.connectors, next],
		});
	};

	const updatePolicy = (policy: DesktopConnectorConfigInput["policy"]) => {
		onChange({ ...value, policy });
	};

	const selectedConnector = snapshot.connectors.find((connector) => connector.id === selectedConnectorId);
	if (selectedConnector) {
		return (
			<ConnectorDetailPage
				connector={selectedConnector}
				value={resolveConnectorValue(value, selectedConnector)}
				onChange={updateConnector}
				policy={value.policy}
				onPolicyChange={updatePolicy}
				onStartOAuth={onStartOAuth}
				onDisconnectOAuth={onDisconnectOAuth}
				onBack={() => setSelectedConnectorId(undefined)}
			/>
		);
	}

	return (
		<ConnectorCatalogPage
			snapshot={snapshot}
			value={value}
			onSelect={setSelectedConnectorId}
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
	readonly onSelect: (connectorId: string) => void;
	readonly onStartOAuth: (connectorId: string) => Promise<DesktopConnectorOAuthStartResult>;
}) {
	const [filter, setFilter] = useState<ConnectorFilter>("all");
	const visibleConnectors = snapshot.connectors.filter((connector) => {
		const connected = isConnectorConnected(connector, resolveConnectorValue(value, connector));
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
				{visibleConnectors.length > 0 ? (
					<table className="w-full table-fixed border-collapse" aria-label="Available connector apps">
						<thead>
							<tr className="border-b border-border/55">
								<th scope="col" className="w-[58%] py-4 text-left text-xs font-semibold text-foreground">
									App
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
							{visibleConnectors.map((connector) => {
								const current = resolveConnectorValue(value, connector);
								return (
									<ConnectorTableRow
										key={connector.id}
										connector={connector}
										connected={isConnectorConnected(connector, current)}
										onSelect={() => onSelect(connector.id)}
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
	connector,
	connected,
	onSelect,
	onStartOAuth,
}: {
	readonly connector: DesktopConnector;
	readonly connected: boolean;
	readonly onSelect: () => void;
	readonly onStartOAuth: (connectorId: string) => Promise<DesktopConnectorOAuthStartResult>;
}) {
	const CheckIcon = useIcon("check");
	const authLabel = getAuthLabel(connector.authTypes);
	const isOAuth = connector.authTypes.includes("oauth");
	const [authorizing, setAuthorizing] = useState(false);
	const [authorizationExpiresAt, setAuthorizationExpiresAt] = useState<number>();
	const [oauthError, setOAuthError] = useState<string>();

	useEffect(() => {
		if (!authorizing) return;
		return window.desktopRpc.onAgentEvent((envelope) => {
			const event = envelope.event;
			if (event.type !== "connector_oauth_completed" && event.type !== "connector_oauth_failed") return;
			if (event.connectorId !== connector.id) return;
			setAuthorizing(false);
			setAuthorizationExpiresAt(undefined);
			if (event.type === "connector_oauth_failed") setOAuthError(event.message);
		});
	}, [authorizing, connector.id]);

	useEffect(() => {
		if (!authorizing || authorizationExpiresAt === undefined) return;
		const timeout = window.setTimeout(
			() => {
				setAuthorizing(false);
				setAuthorizationExpiresAt(undefined);
				setOAuthError("Authorization expired. Try again.");
			},
			Math.max(0, authorizationExpiresAt - Date.now()),
		);
		return () => window.clearTimeout(timeout);
	}, [authorizationExpiresAt, authorizing]);

	const startOAuth = async () => {
		setAuthorizing(true);
		setAuthorizationExpiresAt(undefined);
		setOAuthError(undefined);
		try {
			const result = await onStartOAuth(connector.id);
			setAuthorizationExpiresAt(result.expiresAt);
		} catch (cause) {
			setAuthorizing(false);
			setAuthorizationExpiresAt(undefined);
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
			<td className="py-2.5 pr-4">
				<div className="flex min-w-0 items-center gap-3">
					<span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-white p-1.5">
						<ConnectorBrandLogo connector={connector} size={20} />
					</span>
					<p className="truncate text-[14px] font-semibold tracking-[-0.015em] text-foreground">
						{connector.name}
					</p>
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
	connector,
	value,
	onChange,
	policy,
	onPolicyChange,
	onBack,
	onStartOAuth,
	onDisconnectOAuth,
}: {
	readonly connector: DesktopConnector;
	readonly value: DesktopConnectorConfigInput["connectors"][number];
	readonly onChange: (value: DesktopConnectorConfigInput["connectors"][number]) => void;
	readonly policy: DesktopConnectorConfigInput["policy"];
	readonly onPolicyChange: (value: DesktopConnectorConfigInput["policy"]) => void;
	readonly onBack: () => void;
	readonly onStartOAuth: (connectorId: string) => Promise<DesktopConnectorOAuthStartResult>;
	readonly onDisconnectOAuth: (connectorId: string) => Promise<unknown>;
}) {
	const ArrowLeftIcon = useIcon("arrow-left");
	const isOAuth = connector.authTypes.includes("oauth");
	const connected = isOAuth ? connector.oauth?.connected === true : isConnectorConnected(connector, value);
	const [authorizing, setAuthorizing] = useState(false);
	const [authorizationExpiresAt, setAuthorizationExpiresAt] = useState<number>();
	const [disconnecting, setDisconnecting] = useState(false);
	const [oauthError, setOAuthError] = useState<string>();

	useEffect(() => {
		if (connected) {
			setAuthorizing(false);
			setAuthorizationExpiresAt(undefined);
		}
	}, [connected]);

	useEffect(() => {
		return window.desktopRpc.onAgentEvent((envelope) => {
			if (envelope.event.type !== "connector_oauth_completed" && envelope.event.type !== "connector_oauth_failed")
				return;
			if (envelope.event.connectorId !== connector.id) return;
			setAuthorizing(false);
			setAuthorizationExpiresAt(undefined);
			setOAuthError(envelope.event.type === "connector_oauth_failed" ? envelope.event.message : undefined);
		});
	}, [connector.id]);

	useEffect(() => {
		if (!authorizing || authorizationExpiresAt === undefined) return;
		const timeout = window.setTimeout(
			() => {
				setAuthorizing(false);
				setAuthorizationExpiresAt(undefined);
				setOAuthError("Authorization expired. Try again.");
			},
			Math.max(0, authorizationExpiresAt - Date.now()),
		);
		return () => window.clearTimeout(timeout);
	}, [authorizationExpiresAt, authorizing]);

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
		setAuthorizationExpiresAt(undefined);
		setOAuthError(undefined);
		try {
			const result = await onStartOAuth(connector.id);
			setAuthorizationExpiresAt(result.expiresAt);
		} catch (cause) {
			setAuthorizing(false);
			setAuthorizationExpiresAt(undefined);
			setOAuthError(cause instanceof Error ? cause.message : "Unable to start OAuth authorization.");
		}
	};

	const disconnectOAuth = async () => {
		setDisconnecting(true);
		setOAuthError(undefined);
		try {
			await onDisconnectOAuth(connector.id);
		} catch (cause) {
			setOAuthError(cause instanceof Error ? cause.message : "Unable to disconnect this account.");
		} finally {
			setDisconnecting(false);
		}
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<header className="flex shrink-0 items-center gap-2 px-6 pt-4">
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

			<main className="min-h-0 flex-1 overflow-y-auto px-6 pb-10 pt-2">
				<div className="flex items-start justify-between gap-6">
					<div className="min-w-0">
						<div className="flex min-w-0 items-center gap-4">
							<span className="flex size-6 shrink-0 items-center justify-center rounded-sm border border-border/60 bg-white p-1">
								<ConnectorBrandLogo connector={connector} size={25} />
							</span>
							<h2 className="min-w-0 truncate text-[18px] font-semibold tracking-[-0.025em]">
								{connector.name}
							</h2>
						</div>
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
					{connector.description ?? "Configure this connector so your agent can use its tools."}
				</p>

				{isOAuth ? (
					<section className="mt-5 border-t border-border/55 pt-6">
						<h3 className="text-[14px] font-semibold">Account access</h3>
						<p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
							Connect this app in your browser. Only the permissions required by this app are requested.
						</p>
						{connected ? (
							<p className="mt-5 text-[13px] text-primary">Connected to your {connector.name} account.</p>
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
									{authorizing ? "Finish in browser" : oauthError ? "Retry" : "Connect"}
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
					<CredentialSettings connector={connector} value={value} onChange={onChange} />
				)}
				<ToolPermissionSettings connector={connector} policy={policy} onChange={onPolicyChange} />
			</main>
		</div>
	);
}

function ToolPermissionSettings({
	connector,
	policy,
	onChange,
}: {
	readonly connector: DesktopConnector;
	readonly policy: DesktopConnectorConfigInput["policy"];
	readonly onChange: (value: DesktopConnectorConfigInput["policy"]) => void;
}) {
	const [openGroupIds, setOpenGroupIds] = useState<ReadonlySet<string>>(
		() => new Set(["read", "write", "destructive"]),
	);
	const updateAction = (actionId: string, permission: DesktopConnectorPermission) => {
		onChange({
			...policy,
			actions: { ...policy.actions, [actionId]: permission },
		});
	};
	const updateGroup = (
		sideEffect: DesktopConnector["actions"][number]["sideEffect"],
		permission: DesktopConnectorPermission,
	) => {
		const actions = { ...policy.actions };
		for (const action of connector.actions) {
			if (action.sideEffect === sideEffect) actions[action.actionId] = permission;
		}
		onChange({ ...policy, actions });
	};
	const actions = connector.actions.map((action) => ({
		...action,
		permission: policy.actions[action.actionId] ?? policy.default,
	}));
	const groups = [
		{ id: "read", label: "Read-only tools", actions: actions.filter((action) => action.sideEffect === "read") },
		{ id: "write", label: "Write tools", actions: actions.filter((action) => action.sideEffect === "write") },
		{
			id: "destructive",
			label: "Destructive tools",
			actions: actions.filter((action) => action.sideEffect === "destructive"),
		},
	].filter((group) => group.actions.length > 0);

	return (
		<section className="mt-6 border-t border-border/55 pt-6">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h3 className="text-[14px] font-semibold">Tool permissions</h3>
					<p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
						Choose when the Agent is allowed to use these tools.
					</p>
				</div>
			</div>
			<div className="mt-5">
				{groups.map((group) => (
					<div key={group.id} className="border-b border-border/55 last:border-b-0">
						<div className="flex h-12 items-center justify-between gap-4">
							<GroupDisclosure
								open={openGroupIds.has(group.id)}
								label={group.label}
								count={group.actions.length}
								onToggle={() => {
									setOpenGroupIds((current) => {
										const next = new Set(current);
										if (next.has(group.id)) next.delete(group.id);
										else next.add(group.id);
										return next;
									});
								}}
							/>
							<div className="shrink-0">
								<PermissionSelect
									value={groupPermission(group.actions)}
									ariaLabel={`${group.label} permission`}
									onChange={(permission) => updateGroup(group.actions[0]!.sideEffect, permission)}
								/>
							</div>
						</div>
						{openGroupIds.has(group.id) ? (
							<div className="divide-y divide-border/55 border-t border-border/55">
								{group.actions.map((action) => (
									<div key={action.actionId} className="flex min-h-14 items-center justify-between gap-4 pl-7">
										<p className="min-w-0 truncate text-[13px] text-foreground" title={action.description}>
											{getConnectorActionTitle(action.actionId)}
										</p>
										<PermissionTabs
											value={action.permission}
											ariaLabel={`${action.actionId} permission`}
											onChange={(permission) => updateAction(action.actionId, permission)}
										/>
									</div>
								))}
							</div>
						) : null}
					</div>
				))}
			</div>
		</section>
	);
}

function GroupDisclosure({
	open,
	label,
	count,
	onToggle,
}: {
	readonly open: boolean;
	readonly label: string;
	readonly count: number;
	readonly onToggle: () => void;
}) {
	const ChevronIcon = useIcon("chevron-right");

	return (
		<Button
			type="button"
			variant="ghost"
			size="md"
			className="h-10 min-w-0 flex-1 justify-start px-0"
			contentClassName="min-w-0 justify-start"
			labelClassName="flex min-w-0 items-center gap-2 whitespace-nowrap"
			aria-expanded={open}
			onClick={onToggle}
		>
			<ChevronIcon
				size={16}
				strokeWidth={1.7}
				className={cn("shrink-0 transition-transform duration-80", open && "rotate-90")}
			/>
			<span className="truncate text-[13px] text-foreground">{label}</span>
			<span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{count}</span>
		</Button>
	);
}

function PermissionTabs({
	value,
	ariaLabel,
	onChange,
}: {
	readonly value: DesktopConnectorPermission | "mixed";
	readonly ariaLabel: string;
	readonly onChange: (value: DesktopConnectorPermission) => void;
}) {
	const CheckIcon = useIcon("permission-allow");
	const AskIcon = useIcon("permission-ask");
	const DenyIcon = useIcon("permission-deny");
	const icons = { allow: CheckIcon, ask: AskIcon, deny: DenyIcon };
	const labels = { allow: "Always allow", ask: "Needs approval", deny: "Blocked" } satisfies Record<
		DesktopConnectorPermission,
		string
	>;

	return (
		<fieldset className="flex items-center gap-0.5 rounded-lg border border-border/55 bg-muted/55 p-0.5">
			<legend className="sr-only">{ariaLabel}</legend>
			{(["allow", "ask", "deny"] as const).map((permission) => {
				const Icon = icons[permission];
				return (
					<Tooltip key={permission} content={labels[permission]}>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							className={cn(
								"rounded-md text-muted-foreground",
								value === permission && "bg-card text-foreground shadow-sm",
							)}
							aria-label={labels[permission]}
							aria-pressed={value === permission}
							onClick={() => onChange(permission)}
						>
							<Icon size={15} strokeWidth={1.8} />
						</Button>
					</Tooltip>
				);
			})}
		</fieldset>
	);
}

function PermissionSelect({
	value,
	ariaLabel,
	onChange,
}: {
	readonly value: DesktopConnectorPermission | "mixed";
	readonly ariaLabel: string;
	readonly onChange: (value: DesktopConnectorPermission) => void;
}) {
	const CheckIcon = useIcon("permission-allow");
	const AskIcon = useIcon("permission-ask");
	const DenyIcon = useIcon("permission-deny");
	const CustomIcon = useIcon("dot");
	const icons = { allow: CheckIcon, ask: AskIcon, deny: DenyIcon };
	const selectValue = value === "mixed" ? "custom" : value;
	const TriggerIcon = value === "mixed" ? CustomIcon : icons[value];

	return (
		<Select
			value={selectValue}
			onValueChange={(nextValue) => {
				if (nextValue === "allow" || nextValue === "ask" || nextValue === "deny") onChange(nextValue);
			}}
		>
			<SelectTrigger aria-label={ariaLabel} icon={TriggerIcon} className="w-44 min-w-0" />
			<SelectContent>
				<SelectGroup>
					<SelectItem index={0} value="allow" icon={CheckIcon}>
						Always allow
					</SelectItem>
					<SelectItem index={1} value="ask" icon={AskIcon}>
						Needs approval
					</SelectItem>
					<SelectItem index={2} value="deny" icon={DenyIcon}>
						Blocked
					</SelectItem>
					<SelectItem index={3} value="custom" icon={CustomIcon}>
						Custom
					</SelectItem>
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}

function getConnectorActionTitle(actionId: string): string {
	const shortTitles: Record<string, string> = {
		"context7.search_libraries": "Resolve library",
		"context7.get_documentation_context": "Query docs",
	};
	const knownTitle = shortTitles[actionId];
	if (knownTitle) return knownTitle;
	const name = actionId.slice(actionId.indexOf(".") + 1);
	return name
		.split("_")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

function groupPermission(
	actions: readonly DesktopConnector["actions"][number][],
): DesktopConnectorPermission | "mixed" {
	const permissions = new Set(actions.map((action) => action.permission));
	return permissions.size === 1 ? [...permissions][0]! : "mixed";
}

function CredentialSettings({
	connector,
	value,
	onChange,
}: {
	readonly connector: DesktopConnector;
	readonly value: DesktopConnectorConfigInput["connectors"][number];
	readonly onChange: (value: DesktopConnectorConfigInput["connectors"][number]) => void;
}) {
	return (
		<div className="mt-5 border-t border-border/55 pt-6">
			<div>
				<h3 className="text-[14px] font-semibold">Credentials</h3>
				<p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
					Values are stored in your local settings and are only sent to this connector.
				</p>
				<div className="mt-5 grid max-w-3xl grid-cols-2 gap-x-5 gap-y-5">
					{connector.credentials.map((credential) => (
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

function resolveConnectorValue(
	value: DesktopConnectorConfigInput,
	connector: DesktopConnector,
): DesktopConnectorConfigInput["connectors"][number] {
	return (
		value.connectors.find((candidate) => candidate.id === connector.id) ?? {
			id: connector.id,
			enabled: connector.enabled,
			credentials: {},
		}
	);
}

function isConnectorConnected(
	connector: DesktopConnector,
	value: DesktopConnectorConfigInput["connectors"][number],
): boolean {
	if (connector.oauth) return connector.oauth.connected;
	if (connector.credentials.length === 0) return false;
	return connector.credentials.every((credential) => {
		return credential.configured || Boolean(value.credentials[credential.key]?.trim());
	});
}

function useConnectorIcon(connector: DesktopConnector) {
	const apiKeyIcon = useIcon("key");
	const oauthIcon = useIcon("globe");
	const customIcon = useIcon("link");
	return connector.authTypes.includes("oauth")
		? oauthIcon
		: connector.authTypes.includes("api_key")
			? apiKeyIcon
			: customIcon;
}

function ConnectorBrandLogo({ connector, size }: { readonly connector: DesktopConnector; readonly size: number }) {
	const ConnectorIcon = useConnectorIcon(connector);
	const [imageFailed, setImageFailed] = useState(false);
	if (!connector.iconUrl || imageFailed) return <ConnectorIcon size={size} strokeWidth={1.7} />;
	return (
		<img
			src={connector.iconUrl}
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
		oauth: "Web",
		api_key: "API key",
		custom_credential: "Custom credentials",
	};
	return authTypes.map((authType) => authLabels[authType] ?? authType).join(" · ");
}
