import {
	type CodingAgentSettings,
	type ResolveConfiguredProviderOptions,
	resolveConfiguredProvider,
} from "../runtime/provider-config";
import type { CodingModelResolver } from "../sdk/types";

export interface ConfiguredModelResolverOptions {
	/** Opaque Models.dev catalog supplied by a caller that has already loaded it. */
	readonly catalog?: unknown;
	/** Provider inventory from the caller's last explicit model discovery. */
	readonly availableModelIds?: readonly string[];
	/** Require verified capabilities before an Agent can start. */
	readonly requireVerifiedCapabilities?: boolean;
}

/**
 * Resolves models using Jai's ordinary user and project configuration.
 * Callers only supply optional catalog facts.
 */
export function createConfiguredModelResolver(options: ConfiguredModelResolverOptions = {}): CodingModelResolver {
	const resolutionOptions: ResolveConfiguredProviderOptions = {
		...(options.availableModelIds ? { availableModelIds: options.availableModelIds } : {}),
		requireVerifiedCapabilities: options.requireVerifiedCapabilities ?? false,
	};
	return ({ model, settings }) =>
		resolveConfiguredProvider(settings as CodingAgentSettings, model, options.catalog as never, resolutionOptions);
}

export const configuredModelResolver: CodingModelResolver = createConfiguredModelResolver();
