import { type Static, Type } from "@sinclair/typebox";
import type { ConfigFieldTree } from "../config";
import type { PermissionSettings, ResolvedPermissionSettings } from "./types";

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

export function normalizePermissionSettings(settings: PermissionSettings = {}): ResolvedPermissionSettings {
	return Object.freeze({
		defaultMode: settings.defaultMode ?? "default",
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
