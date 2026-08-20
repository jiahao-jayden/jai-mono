import { type Static, Type } from "@sinclair/typebox";
import type { ConfigFieldTree } from "./store";

export type DesktopPermissionAction = "allow" | "ask" | "deny";
export type DesktopPermissionConfig = Readonly<
	Record<string, DesktopPermissionAction | Readonly<Record<string, DesktopPermissionAction>>>
>;

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

export type DesktopPermissionSettings = Static<typeof permissionSettingsSchema> & {
	readonly permission?: DesktopPermissionConfig;
};

export const permissionConfigFields = {
	defaultMode: { merge: "replace", project: "trusted", default: "default" },
	allow: {
		merge: "appendUnique",
		project: "trusted",
		default: [],
		uniqueBy: (value: unknown) => String(value),
	},
	ask: {
		merge: "appendUnique",
		project: "always",
		default: [],
		uniqueBy: (value: unknown) => String(value),
	},
	deny: { merge: "denyUnion", project: "always", default: [] },
	additionalDirectories: {
		merge: "appendUnique",
		project: "trusted",
		default: [],
		uniqueBy: (value: unknown) => String(value),
	},
	disableBypassPermissionsMode: {
		merge: "restrictOnly",
		project: "always",
		combineRestrictions: () => "disable",
	},
} satisfies ConfigFieldTree;

export function mergePermissionConfigs(candidates: readonly { readonly value: unknown }[]): DesktopPermissionConfig {
	const merged: Record<string, DesktopPermissionAction | Record<string, DesktopPermissionAction>> = {};
	for (const candidate of candidates) {
		if (!isRecord(candidate.value)) continue;
		for (const [permission, value] of Object.entries(candidate.value)) {
			if (value === "allow" || value === "ask" || value === "deny") {
				merged[permission] = value;
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
