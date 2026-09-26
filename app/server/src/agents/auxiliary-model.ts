import type { CodingAuxiliaryModel } from "@jai/coding-agent";
import type { SqliteRuntimeAgentSettings } from "../config";
import {
	type RuntimeModelCatalogSnapshot,
	resolveRuntimeModelCompatibilityProfile,
	resolveRuntimeModelMetadata,
} from "../model-catalog";

/**
 * Resolves one Operation's auxiliary model from Runtime Agent settings.
 *
 * - `undefined`: no model is chosen; the Coding Agent reviews with the Session
 *   model, so the "follow the Session model" rule has exactly one owner.
 * - `unavailable`: a chosen model cannot be used right now (disabled, missing
 *   credential, unreadable settings). Review then asks the user; it never
 *   silently falls back to a different model.
 *
 * Only the connection is resolved: the Session's instructions, reasoning and
 * provider options are deliberately not carried over.
 */
export function resolveOperationAuxiliaryModel(
	settings: SqliteRuntimeAgentSettings,
	catalog: RuntimeModelCatalogSnapshot,
): CodingAuxiliaryModel | undefined {
	const resolved = settings.resolveAuxiliaryModel();
	if (resolved.isErr()) return { kind: "unavailable" };
	if (!resolved.value) return undefined;
	const { reference, model, provider } = resolved.value;
	const compatibilityProfile = resolveRuntimeModelCompatibilityProfile(reference, provider, catalog, model);
	if (compatibilityProfile.isErr()) return { kind: "unavailable" };
	return {
		kind: "model",
		model,
		provider,
		compatibilityProfile: compatibilityProfile.value,
		modelMetadata: resolveRuntimeModelMetadata(reference, provider, catalog),
	};
}
