import { stat } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { CodingSdkFailure, isRecord } from "./project";
import type { CodingAgentCreateOptions } from "./types";

/** Fuse for an unattended run; pass `maxTurns: Infinity` to opt out explicitly. */
export const DEFAULT_MAX_TURNS = 100;

const permissionModeSchema = Type.Union([
	Type.Literal("ask"),
	Type.Literal("allow"),
	Type.Literal("auto"),
	Type.Literal("plan"),
]);

export function resolveMaxIterations(maxTurns: number | undefined): number | undefined {
	if (maxTurns === Number.POSITIVE_INFINITY) return undefined;
	return maxTurns ?? DEFAULT_MAX_TURNS;
}

function invalidOptions(message: string): CodingSdkFailure {
	return new CodingSdkFailure({ phase: "runtime_creation", code: "coding_sdk.invalid_options", message });
}

/**
 * Rejects scalar options that would otherwise silently change behaviour (a typo'd `permissionMode`
 * degrades to `ask`, `maxTurns: NaN` never stops). Only validates; model, provider and tool
 * options are validated by their own resolvers.
 */
export async function validateCreateOptions(input: CodingAgentCreateOptions): Promise<void> {
	if (!isRecord(input)) throw invalidOptions("Options must be an object");
	const { maxTurns, permissionMode, cwd } = input;
	if (
		maxTurns !== undefined &&
		maxTurns !== Number.POSITIVE_INFINITY &&
		!(Number.isInteger(maxTurns) && maxTurns > 0)
	) {
		throw invalidOptions("maxTurns must be a positive integer or Infinity");
	}
	if (permissionMode !== undefined && !Value.Check(permissionModeSchema, permissionMode)) {
		throw invalidOptions("permissionMode must be one of ask, allow, auto, plan");
	}
	if (cwd !== undefined) {
		const info = typeof cwd === "string" && cwd ? await stat(cwd).catch(() => undefined) : undefined;
		if (!info?.isDirectory()) throw invalidOptions("cwd must be an existing directory");
	}
}
