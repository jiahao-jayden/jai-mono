import type { CodingAgentSettings } from "@jai/coding-agent/jai-host";
import type { DesktopProviderConfigInput, DesktopProviderConfigSnapshot } from "../../shared/desktop-rpc";

export type SystemConfigProjection = Pick<
	DesktopProviderConfigSnapshot,
	"language" | "maxIterations" | "reasoningEffort"
>;

/**
 * The desktop currently exposes these agent defaults alongside provider settings.
 * Keeping their projection and persistence here leaves a seam for the future
 * system configuration without inventing new persisted fields today.
 */
export function projectSystemConfig(settings: Readonly<CodingAgentSettings>): SystemConfigProjection {
	return {
		...(settings.agent?.language ? { language: settings.agent.language } : {}),
		...(settings.agent?.maxIterations ? { maxIterations: settings.agent.maxIterations } : {}),
		...(settings.agent?.reasoningEffort ? { reasoningEffort: settings.agent.reasoningEffort } : {}),
	};
}

export function toStoredSystemConfig(
	input: Pick<DesktopProviderConfigInput, "language" | "maxIterations" | "reasoningEffort">,
): CodingAgentSettings["agent"] | undefined {
	const agent = {
		...(input.language ? { language: input.language } : {}),
		...(input.maxIterations ? { maxIterations: input.maxIterations } : {}),
		...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
	};
	return Object.keys(agent).length > 0 ? agent : undefined;
}

export function isSystemConfigInput(
	input: Pick<DesktopProviderConfigInput, "language" | "maxIterations" | "reasoningEffort">,
): boolean {
	return !(
		(input.language !== undefined &&
			(typeof input.language !== "string" || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(input.language))) ||
		(input.maxIterations !== undefined && (!Number.isInteger(input.maxIterations) || input.maxIterations < 1)) ||
		(input.reasoningEffort !== undefined &&
			input.reasoningEffort !== "low" &&
			input.reasoningEffort !== "medium" &&
			input.reasoningEffort !== "high")
	);
}
