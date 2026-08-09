import { createDefaultConnectorService } from "../providers";
import { OAuthGatewayClient } from "../oauth";
import { parseConnectorOAuthScopes } from "../oauth-providers";
import type { ConnectorConfigStore, ConnectorSettings } from "../types";
import { startManagedConnectorService } from "./index";

const defaultOAuthGatewayEndpoint = "https://jai-connector.jayden0.com";
const oauthRefreshLeadMs = 5 * 60_000;
const oauthRefreshIntervalMs = 60_000;

export interface ConnectorServiceProcessOptions {
	readonly configStore: ConnectorConfigStore;
	readonly discoveryFile?: string;
	readonly runtimeTokenFile?: string;
	readonly logDirectory?: string;
	readonly homeDirectory?: string;
	readonly oauthGatewayEndpoint?: string;
}

export async function runConnectorServiceProcess(options: ConnectorServiceProcessOptions): Promise<void> {
	const loaded = await options.configStore.load();
	if (loaded.isErr()) throw loaded.error;
	const service = createDefaultConnectorService(loaded.value.settings);
	const oauthGateway = new OAuthGatewayClient({ endpoint: options.oauthGatewayEndpoint ?? defaultOAuthGatewayEndpoint });
	let stopped = false;
	let resolveStopped: (() => void) | undefined;
	const stoppedPromise = new Promise<void>((resolve) => {
		resolveStopped = resolve;
	});
	const stop = () => {
		if (stopped) return;
		stopped = true;
		resolveStopped?.();
	};
	const stopConfigWatch = options.configStore.watch((event) => {
		if (event.status !== "valid") return;
		service.applyConfiguration(createDefaultConnectorService(event.snapshot.settings));
	});
	const refreshOAuthTokens = () => refreshExpiringOAuthTokens(options.configStore, service, oauthGateway);
	void refreshOAuthTokens();
	const refreshTimer = setInterval(() => void refreshOAuthTokens(), oauthRefreshIntervalMs);
	const started = await startManagedConnectorService(service, {
		homeDirectory: options.homeDirectory,
		paths: {
			...(options.discoveryFile ? { discoveryFile: options.discoveryFile } : {}),
			...(options.runtimeTokenFile ? { runtimeTokenFile: options.runtimeTokenFile } : {}),
			...(options.logDirectory ? { logDirectory: options.logDirectory } : {}),
		},
	});
	if (started.isErr()) {
		clearInterval(refreshTimer);
		stopConfigWatch();
		options.configStore.close();
		throw started.error;
	}
	const runtime = started.value;
	const close = () => stop();
	process.once("SIGINT", close);
	process.once("SIGTERM", close);
	await stoppedPromise;
	process.off("SIGINT", close);
	process.off("SIGTERM", close);
	clearInterval(refreshTimer);
	stopConfigWatch();
	await runtime.close();
	options.configStore.close();
}

async function refreshExpiringOAuthTokens(
	configStore: ConnectorConfigStore,
	service: ReturnType<typeof createDefaultConnectorService>,
	gateway: OAuthGatewayClient,
): Promise<void> {
	const loaded = await configStore.load();
	if (loaded.isErr()) return;
	const providers = loaded.value.settings.providers ?? {};
	let changed = false;
	const nextProviders = { ...providers };
	for (const providerId of ["google", "github"] as const) {
		const provider = providers[providerId];
		const credentials = provider?.credentials;
		const refreshToken = credentials?.refreshToken;
		const expiresAt = Number(credentials?.expiresAt);
		if (!provider || !credentials || !refreshToken || !Number.isFinite(expiresAt) || expiresAt > Date.now() + oauthRefreshLeadMs) {
			continue;
		}
		const refreshed = await gateway.refresh(providerId, refreshToken);
		if (refreshed.isErr()) continue;
		const { expiresAt: _previousExpiry, ...credentialsWithoutExpiry } = credentials;
		const returnedScopes = parseConnectorOAuthScopes(refreshed.value.scope);
		nextProviders[providerId] = {
			...provider,
			credentials: {
				...credentialsWithoutExpiry,
				accessToken: refreshed.value.accessToken,
				tokenType: refreshed.value.tokenType,
				refreshToken: refreshed.value.refreshToken ?? refreshToken,
				scopes: (returnedScopes.length > 0 ? returnedScopes : parseConnectorOAuthScopes(credentials.scopes)).join(" "),
				...(refreshed.value.expiresIn === undefined ? {} : { expiresAt: String(Date.now() + refreshed.value.expiresIn * 1_000) }),
			},
		};
		changed = true;
	}
	if (!changed) return;
	const nextSettings: ConnectorSettings = { ...loaded.value.settings, providers: nextProviders };
	const saved = await configStore.save(nextSettings, { expectedRevision: loaded.value.revision });
	if (saved.isOk()) service.applyConfiguration(createDefaultConnectorService(saved.value.settings));
}
