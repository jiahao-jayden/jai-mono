import {
	type CodingAgentSettings,
	type ResolveConfiguredProviderOptions,
	resolveConfiguredProvider,
} from "../runtime/provider-config";
import type { CodingModelAuthority } from "../sdk/types";

export interface ConfiguredModelAuthorityOptions {
	/** Opaque Models.dev catalog supplied by a host that has already loaded it. */
	readonly catalog?: unknown;
	/** Provider inventory from the host's last explicit model discovery. */
	readonly availableModelIds?: readonly string[];
	/** Require verified capabilities before an Agent can start. */
	readonly requireVerifiedCapabilities?: boolean;
}

/**
 * The standard authority for hosts that use Jai's ordinary user/project configuration.
 * Provider resolution remains inside the SDK; hosts only supply optional catalog facts.
 */
export function createConfiguredModelAuthority(options: ConfiguredModelAuthorityOptions = {}): CodingModelAuthority {
	const resolutionOptions: ResolveConfiguredProviderOptions = {
		...(options.availableModelIds ? { availableModelIds: options.availableModelIds } : {}),
		requireVerifiedCapabilities: options.requireVerifiedCapabilities ?? false,
	};
	return {
		resolve({ model, settings }) {
			return resolveConfiguredProvider(
				settings as CodingAgentSettings,
				model,
				options.catalog as never,
				resolutionOptions,
			);
		},
	};
}

export const configuredModelAuthority: CodingModelAuthority = createConfiguredModelAuthority();
