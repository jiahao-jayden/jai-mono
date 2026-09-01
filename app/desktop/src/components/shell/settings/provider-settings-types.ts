import type { DesktopProviderModel, DesktopProviderProfile } from "../../../../shared/desktop-rpc";

export interface ProfileDraft extends DesktopProviderProfile {
	apiKey: string;
	clearApiKey: boolean;
	models: DesktopProviderModel[];
	persistedId?: string;
}

const profileIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export type ProviderDraftValidationError =
	| { readonly kind: "invalid-max-iterations" }
	| { readonly kind: "provider-name-required" }
	| { readonly kind: "profile-id-invalid"; readonly id: string }
	| { readonly kind: "profile-id-duplicate"; readonly id: string }
	| { readonly kind: "provider-api-key-required"; readonly name: string };

export function toProfileDraft(profile: DesktopProviderProfile): ProfileDraft {
	return { ...profile, models: [...profile.models], apiKey: "", clearApiKey: false, persistedId: profile.id };
}

export function validateProviderDraft(
	profiles: readonly ProfileDraft[],
	maxIterations: string,
): ProviderDraftValidationError | undefined {
	if (maxIterations && (!Number.isInteger(Number(maxIterations)) || Number(maxIterations) < 1)) {
		return { kind: "invalid-max-iterations" };
	}
	const profileIds = new Set<string>();
	for (const profile of profiles) {
		if (!profile.name.trim()) return { kind: "provider-name-required" };
		if (!profileIdPattern.test(profile.id)) return { kind: "profile-id-invalid", id: profile.id };
		if (profileIds.has(profile.id)) return { kind: "profile-id-duplicate", id: profile.id };
		profileIds.add(profile.id);
		if (profile.authentication === "api-key" && !profile.credentialConfigured && !profile.apiKey.trim()) {
			return { kind: "provider-api-key-required", name: profile.name };
		}
	}
	return undefined;
}

export function uniqueProfileId(profiles: readonly ProfileDraft[], base: string): string {
	const ids = new Set(profiles.map((profile) => profile.id));
	if (!ids.has(base)) return base;
	let suffix = 2;
	while (ids.has(`${base}-${suffix}`)) suffix++;
	return `${base}-${suffix}`;
}
