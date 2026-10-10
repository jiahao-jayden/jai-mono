import { stat } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { CodingSdkFailure, isRecord } from "./project";
import type { CodingAgentCreateOptions } from "./types";

/** Deadline for Extension hooks that block the run (`beforeAgentStart`, `beforeModelCall`). */
export const DEFAULT_HOOK_TIMEOUT_MS = 30_000;

const permissionModeSchema = Type.Union([
	Type.Literal("ask"),
	Type.Literal("allow"),
	Type.Literal("auto"),
	Type.Literal("plan"),
]);

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
	const { maxTurns, permissionMode, cwd, hookTimeoutMs } = input;
	if (hookTimeoutMs !== undefined && !(typeof hookTimeoutMs === "number" && hookTimeoutMs > 0)) {
		throw invalidOptions("hookTimeoutMs must be a positive number or Infinity");
	}
	if (maxTurns !== undefined && !(Number.isInteger(maxTurns) && maxTurns > 0)) {
		throw invalidOptions("maxTurns must be a positive integer");
	}
	if (permissionMode !== undefined && !Value.Check(permissionModeSchema, permissionMode)) {
		throw invalidOptions("permissionMode must be one of ask, allow, auto, plan");
	}
	if (cwd !== undefined) {
		const info = typeof cwd === "string" && cwd ? await stat(cwd).catch(() => undefined) : undefined;
		if (!info?.isDirectory()) throw invalidOptions("cwd must be an existing directory");
	}
}
