import {
	createWebSearchExtension,
	type WebSearchProviderConfiguration,
} from "@jai/extension/web-search";
import type { CodingAgentCreateOptions } from "@jai/coding-agent";
import { Result, type Result as ResultType } from "better-result";
import type { RuntimeAgentSettingsReadError, RuntimeWebSearchProviderId, SqliteRuntimeAgentSettings } from "../config";

export interface RuntimeWebSearchAgentAssembly {
	readonly extensions: NonNullable<CodingAgentCreateOptions["extensions"]>;
}

export function createRuntimeWebSearchAgentAssembly(
	settings: SqliteRuntimeAgentSettings,
): ResultType<RuntimeWebSearchAgentAssembly, RuntimeAgentSettingsReadError> {
	const configured = settings.readWebSearchSettings();
	if (configured.isErr()) return Result.err(configured.error);
	const providers: WebSearchProviderConfiguration[] = (Object.entries(configured.value.providers) as [
		RuntimeWebSearchProviderId,
		{ readonly enabled: boolean; readonly order?: number; readonly apiKey?: string },
	][]).map(([id, provider]) => ({
		id,
		enabled: provider.enabled,
		...(provider.order === undefined ? {} : { order: provider.order }),
		...(provider.apiKey === undefined ? {} : { apiKey: provider.apiKey }),
	}));
	return Result.ok({
		extensions: [
			createWebSearchExtension({
				providers,
				jinaApiKey: configured.value.fetch?.jina.apiKey,
			}),
		],
	});
}
