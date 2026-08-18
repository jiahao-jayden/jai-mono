import { type Static, Type } from "@sinclair/typebox";
import type { ConfigFieldTree } from "../config";
import type { PermissionAction, PermissionConfig, PermissionSettings, ResolvedPermissionSettings } from "./types";

export const permissionActionSchema = Type.Union([Type.Literal("allow"), Type.Literal("ask"), Type.Literal("deny")]);
export const permissionRuleValueSchema = Type.Union([
	permissionActionSchema,
	Type.Record(Type.String({ minLength: 1 }), permissionActionSchema),
]);
export const permissionConfigSchema = Type.Record(Type.String({ minLength: 1 }), permissionRuleValueSchema);

const permissionModeSchema = Type.Union([
	Type.Literal("default"),
	Type.Literal("acceptEdits"),
	Type.Literal("plan"),
	Type.Literal("dontAsk"),
	Type.Literal("bypassPermissions"),
]);

export const permissionSettingsSchema = Type.Object(
	{
		defaultMode: Type.Optional(permissionModeSchema),
		allow: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
		ask: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
		deny: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
		additionalDirectories: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
		disableBypassPermissionsMode: Type.Optional(Type.Literal("disable")),
	},
	{ additionalProperties: false },
);

export type PermissionSettingsDocument = Static<typeof permissionSettingsSchema>;

export const permissionConfigFields = {
	defaultMode: { merge: "replace", project: "trusted", default: "default" },
	allow: {
		merge: "appendUnique",
		project: "trusted",
		default: [],
		uniqueBy: (value) => String(value),
	},
	ask: {
		merge: "appendUnique",
		project: "always",
		default: [],
		uniqueBy: (value) => String(value),
	},
	deny: { merge: "denyUnion", project: "always", default: [] },
	additionalDirectories: {
		merge: "appendUnique",
		project: "trusted",
		default: [],
		uniqueBy: (value) => String(value),
	},
	disableBypassPermissionsMode: {
		merge: "restrictOnly",
		project: "always",
		combineRestrictions: () => "disable",
	},
} satisfies ConfigFieldTree;

export function mergePermissionConfigs(candidates: readonly { readonly value: unknown }[]): PermissionConfig {
	const merged: Record<string, PermissionAction | Record<string, PermissionAction>> = {};
	for (const candidate of candidates) {
		if (!isRecord(candidate.value)) continue;
		for (const [permission, value] of Object.entries(candidate.value)) {
			if (typeof value === "string") {
				merged[permission] = value as PermissionAction;
				continue;
			}
			if (!isRecord(value)) continue;
			const patterns = isRecord(merged[permission]) ? { ...merged[permission] } : {};
			for (const [pattern, action] of Object.entries(value)) {
				if (action === "allow" || action === "ask" || action === "deny") patterns[pattern] = action;
			}
			merged[permission] = patterns;
		}
	}
	return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizePermissionSettings(settings: PermissionSettings = {}): ResolvedPermissionSettings {
	return Object.freeze({
		defaultMode: settings.defaultMode ?? "default",
		...(settings.permission && Object.keys(settings.permission).length > 0
			? { permission: Object.freeze(settings.permission) }
			: {}),
		allow: Object.freeze(unique(settings.allow)),
		ask: Object.freeze(unique(settings.ask)),
		deny: Object.freeze(unique(settings.deny)),
		additionalDirectories: Object.freeze(unique(settings.additionalDirectories)),
		...(settings.disableBypassPermissionsMode === "disable"
			? { disableBypassPermissionsMode: "disable" as const }
			: {}),
	});
}

function unique(values: readonly string[] | undefined): string[] {
	return [...new Set(values ?? [])];
}
