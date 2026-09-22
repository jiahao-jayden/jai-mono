import { type Static, Type } from "@sinclair/typebox";
import type { ConfigFieldTree } from "../config";
import {
	isPermissionAction,
	type PermissionConfig,
	type PermissionEffect,
	type PermissionGrantConfig,
	type PermissionMode,
	type PermissionSettings,
	type ResolvedPermissionSettings,
} from "./types";

export const permissionActionSchema = Type.Union([Type.Literal("allow"), Type.Literal("ask"), Type.Literal("deny")]);
export const permissionRuleValueSchema = Type.Union([
	permissionActionSchema,
	Type.Record(Type.String({ minLength: 1 }), permissionActionSchema),
]);
export const permissionConfigSchema = Type.Partial(
	Type.Object(
		{
			"file.read": permissionRuleValueSchema,
			"file.write": permissionRuleValueSchema,
			"process.exec": permissionRuleValueSchema,
			"tool.invoke": permissionRuleValueSchema,
		},
		{ additionalProperties: false },
	),
);

export const permissionGrantConfigSchema = Type.Record(Type.String({ minLength: 1 }), permissionConfigSchema);

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
		additionalDirectories: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
		disableBypassPermissionsMode: Type.Optional(Type.Literal("disable")),
	},
	{ additionalProperties: false },
);

export type PermissionSettingsDocument = Static<typeof permissionSettingsSchema>;

export const permissionConfigFields = {
	defaultMode: { merge: "replace", project: "trusted", default: "default" },
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
	const merged: Record<string, PermissionEffect | Record<string, PermissionEffect>> = {};
	for (const candidate of candidates) {
		if (!isRecord(candidate.value)) continue;
		for (const [permission, value] of Object.entries(candidate.value)) {
			if (!isPermissionAction(permission)) continue;
			if (typeof value === "string") {
				if (value === "allow" || value === "ask" || value === "deny") merged[permission] = value;
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
		permission:
			settings.permission && Object.keys(settings.permission).length > 0
				? Object.freeze(settings.permission)
				: undefined,
		sessionGrants:
			settings.sessionGrants && Object.keys(settings.sessionGrants).length > 0
				? Object.freeze(settings.sessionGrants)
				: undefined,
		permissionGrants:
			settings.permissionGrants && Object.keys(settings.permissionGrants).length > 0
				? Object.freeze(settings.permissionGrants)
				: undefined,
		additionalDirectories: Object.freeze(unique(settings.additionalDirectories)),
		disableBypassPermissionsMode: settings.disableBypassPermissionsMode === "disable" ? "disable" : undefined,
	});
}

export function permissionSettingsFromConfig(
	settings: Readonly<Record<string, unknown>>,
	mode?: PermissionMode,
): PermissionSettings {
	const policy = isRecord(settings.permissions) ? (settings.permissions as PermissionSettings) : {};
	return {
		...policy,
		permission: isRecord(settings.permission) ? (settings.permission as PermissionConfig) : policy.permission,
		permissionGrants: isRecord(settings.permissionGrants)
			? (settings.permissionGrants as PermissionGrantConfig)
			: policy.permissionGrants,
		defaultMode: mode || policy.defaultMode,
	};
}

function unique(values: readonly string[] | undefined): string[] {
	return [...new Set(values ?? [])];
}
