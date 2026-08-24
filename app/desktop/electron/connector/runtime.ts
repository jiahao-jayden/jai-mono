import {
	type ConnectorSettings,
	connectorOAuthApplicationDefinitions,
	createDefaultConnectorService,
	type MemoryConnectorService,
	OAuthGatewayClient,
	parseConnectorOAuthScopes,
} from "@jai/connector";
import { createDesktopConnectorConfigStore } from "../config/connector-store";

const oauthGatewayEndpoint = "https://jai-connector.jayden0.com";
const oauthRefreshLeadMs = 5 * 60_000;
const oauthRefreshIntervalMs = 60_000;

export interface DesktopConnectorRuntime {
	readonly service: MemoryConnectorService;
	readonly close: () => void;
}

export async function openDesktopConnectorRuntime(): Promise<DesktopConnectorRuntime> {
	const configStore = createDesktopConnectorConfigStore();
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
		const connectors = current.value.settings.connectors ?? {};
		let changed = false;
		const nextConnectors = { ...connectors };
		for (const application of connectorOAuthApplicationDefinitions) {
			const applicationSettings = connectors[application.id];
			const credentials = applicationSettings?.credentials;
			const refreshToken = credentials?.refreshToken;
			const expiresAt = Number(credentials?.expiresAt);
			if (
				!applicationSettings ||
				!credentials ||
				!refreshToken ||
				!Number.isFinite(expiresAt) ||
				expiresAt > Date.now() + oauthRefreshLeadMs
			) {
				continue;
			}
			const refreshed = await oauthGateway.refresh(application.oauthServiceId, refreshToken);
			if (refreshed.isErr()) continue;
			const { expiresAt: _previousExpiry, ...credentialsWithoutExpiry } = credentials;
			const returnedScopes = parseConnectorOAuthScopes(refreshed.value.scope);
			nextConnectors[application.id] = {
				...applicationSettings,
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
		const nextSettings: ConnectorSettings = { ...current.value.settings, connectors: nextConnectors };
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
