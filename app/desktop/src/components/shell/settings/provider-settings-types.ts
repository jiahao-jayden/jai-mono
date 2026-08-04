import type { DesktopProviderModel, DesktopProviderProfile } from "../../../../shared/desktop-rpc";

export interface ProfileDraft extends DesktopProviderProfile {
	apiKey: string;
	clearApiKey: boolean;
	models: DesktopProviderModel[];
	persistedId?: string;
}

const profileIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function toProfileDraft(profile: DesktopProviderProfile): ProfileDraft {
	return { ...profile, models: [...profile.models], apiKey: "", clearApiKey: false, persistedId: profile.id };
}

export function validateProviderDraft(
	profiles: readonly ProfileDraft[],
	language: string,
	maxIterations: string,
): string | undefined {
	if (language && !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(language)) {
		return "Response language 必须是有效的 BCP-47 标记，例如 zh-CN。";
	}
	if (maxIterations && (!Number.isInteger(Number(maxIterations)) || Number(maxIterations) < 1)) {
		return "Max iterations 必须是正整数。";
	}
	const profileIds = new Set<string>();
	for (const profile of profiles) {
		if (!profile.name.trim()) return "每个 Provider 都需要名称。";
		if (!profileIdPattern.test(profile.id)) return `Profile ID "${profile.id}" 格式无效。`;
		if (profileIds.has(profile.id)) return `Profile ID "${profile.id}" 重复。`;
		profileIds.add(profile.id);
		if (profile.authentication === "api-key" && !profile.credentialConfigured && !profile.apiKey.trim()) {
			return `${profile.name} 需要 API key。`;
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
