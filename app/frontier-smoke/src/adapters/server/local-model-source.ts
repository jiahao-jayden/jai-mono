import type { RuntimeProviderAdapter, RuntimeProviderProfileProjection } from "@jai/server";
import { connectDesktopConfigurationClient } from "@jai/server/desktop-configuration-client";
import { Result, type Result as ResultType } from "better-result";
import { FrontierProviderUnavailable } from "../../core/errors";
import type { GatewayModelSource } from "../../core/types";

export interface ResolveLocalModelSourceInput {
	readonly model: string;
	readonly dataDirectory?: string;
}

/**
 * Reads the Server-owned local configuration through its private DTO channel.
 * The selected credential is revealed only long enough to launch the gateway;
 * no caller receives it in a result projection or log DTO.
 */
export async function resolveLocalModelSource(
	input: ResolveLocalModelSourceInput,
): Promise<ResultType<GatewayModelSource, FrontierProviderUnavailable>> {
	const selection = splitModel(input.model);
	if (!selection) {
		return Result.err(
			new FrontierProviderUnavailable({ message: "--model must be a configured profile/model value" }),
		);
	}
	const connected = await connectDesktopConfigurationClient({
		...(input.dataDirectory === undefined ? {} : { dataDirectory: input.dataDirectory }),
	});
	if (connected.isErr()) {
		return Result.err(
			new FrontierProviderUnavailable({ message: "Could not connect to the local Jai configuration" }),
		);
	}
	try {
		const snapshot = await connected.value.get();
		if (snapshot.isErr()) {
			return Result.err(new FrontierProviderUnavailable({ message: "Could not read the local Jai configuration" }));
		}
		const profile = snapshot.value.profiles.find((candidate) => candidate.id === selection.profileId);
		if (!profile?.enabled) {
			return Result.err(
				new FrontierProviderUnavailable({ message: `Model profile "${selection.profileId}" is not enabled` }),
			);
		}
		const configuredModel = profile.models.find(
			(candidate) => candidate.enabled && (candidate.remoteModelId ?? candidate.id) === selection.remoteModelId,
		);
		if (!configuredModel) {
			return Result.err(
				new FrontierProviderUnavailable({
					message: `Model "${input.model}" is not enabled in local Jai configuration`,
				}),
			);
		}
		const upstreamBaseUrl = resolveUpstreamBaseUrl(profile);
		if (!upstreamBaseUrl) {
			return Result.err(
				new FrontierProviderUnavailable({
					message: `Profile "${selection.profileId}" has no supported upstream URL`,
				}),
			);
		}
		const credential =
			profile.authentication === "api-key"
				? await connected.value.revealApiKey(profile.id)
				: Result.ok<undefined, never>(undefined);
		if (credential.isErr() || (profile.authentication === "api-key" && !credential.value?.apiKey)) {
			return Result.err(
				new FrontierProviderUnavailable({
					message: `Profile "${selection.profileId}" has no usable API credential`,
				}),
			);
		}
		return Result.ok({
			requestedModel: input.model,
			adapter: profile.adapter,
			upstreamBaseUrl,
			upstreamAuthentication: profile.authentication,
			...(credential.value?.apiKey === undefined ? {} : { upstreamApiKey: credential.value.apiKey }),
			remoteModelId: configuredModel.remoteModelId ?? configuredModel.id,
		});
	} finally {
		await connected.value.close();
	}
}

function splitModel(model: string): { readonly profileId: string; readonly remoteModelId: string } | undefined {
	const separator = model.indexOf("/");
	if (separator < 1 || separator === model.length - 1) return undefined;
	const profileId = model.slice(0, separator).trim();
	const remoteModelId = model.slice(separator + 1).trim();
	return profileId && remoteModelId ? { profileId, remoteModelId } : undefined;
}

function resolveUpstreamBaseUrl(profile: RuntimeProviderProfileProjection): string | undefined {
	const candidate = profile.baseURL ?? defaultBaseUrl(profile.adapter);
	try {
		const parsed = new URL(candidate);
		return parsed.protocol === "https:" || parsed.protocol === "http:"
			? trimTrailingSlash(parsed.toString())
			: undefined;
	} catch {
		return undefined;
	}
}

function defaultBaseUrl(adapter: RuntimeProviderAdapter): string {
	if (adapter === "anthropic") return "https://api.anthropic.com";
	return "https://api.openai.com/v1";
}

function trimTrailingSlash(value: string): string {
	return value.endsWith("/") ? value.slice(0, -1) : value;
}
