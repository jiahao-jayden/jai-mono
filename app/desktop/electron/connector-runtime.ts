import { createCodingConnectorConfigStore } from "@jai/coding/connector";
import {
	type ConnectorSettings,
	createDefaultConnectorService,
	type MemoryConnectorService,
	OAuthGatewayClient,
	parseConnectorOAuthScopes,
} from "@jai/connector";

const oauthGatewayEndpoint = "https://jai-connector.jayden0.com";
const oauthRefreshLeadMs = 5 * 60_000;
const oauthRefreshIntervalMs = 60_000;

export interface DesktopConnectorRuntime {
	readonly service: MemoryConnectorService;
	readonly close: () => void;
}

export async function openDesktopConnectorRuntime(): Promise<DesktopConnectorRuntime> {
	const configStore = createCodingConnectorConfigStore();
	const loaded = await configStore.load();
	if (loaded.isErr()) {
		configStore.close();
		throw loaded.error;
	}
	const service = createDefaultConnectorService(loaded.value.settings);
	const oauthGateway = new OAuthGatewayClient({ endpoint: oauthGatewayEndpoint });
	const stopConfigWatch = configStore.watch((event) => {
		if (event.status === "valid") {
			service.applyConfiguration(createDefaultConnectorService(event.snapshot.settings));
		}
	});
	const refreshOAuthTokens = async () => {
		const current = await configStore.load();
		if (current.isErr()) return;
		const providers = current.value.settings.providers ?? {};
		let changed = false;
		const nextProviders = { ...providers };
		for (const providerId of ["google", "github"] as const) {
			const provider = providers[providerId];
			const credentials = provider?.credentials;
			const refreshToken = credentials?.refreshToken;
			const expiresAt = Number(credentials?.expiresAt);
			if (
				!provider ||
				!credentials ||
				!refreshToken ||
				!Number.isFinite(expiresAt) ||
				expiresAt > Date.now() + oauthRefreshLeadMs
			) {
				continue;
			}
			const refreshed = await oauthGateway.refresh(providerId, refreshToken);
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
					scopes: (returnedScopes.length > 0
						? returnedScopes
						: parseConnectorOAuthScopes(credentials.scopes)
					).join(" "),
					...(refreshed.value.expiresIn === undefined
						? {}
						: { expiresAt: String(Date.now() + refreshed.value.expiresIn * 1_000) }),
				},
			};
			changed = true;
		}
		if (!changed) return;
		const nextSettings: ConnectorSettings = { ...current.value.settings, providers: nextProviders };
		const saved = await configStore.save(nextSettings, { expectedRevision: current.value.revision });
		if (saved.isOk()) service.applyConfiguration(createDefaultConnectorService(saved.value.settings));
	};
	void refreshOAuthTokens();
	const refreshTimer = setInterval(() => void refreshOAuthTokens(), oauthRefreshIntervalMs);
	let closed = false;
	return {
		service,
		close() {
			if (closed) return;
			closed = true;
			clearInterval(refreshTimer);
			stopConfigWatch();
			configStore.close();
		},
	};
}
