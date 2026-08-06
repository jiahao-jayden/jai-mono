import { Type } from "@sinclair/typebox";

export const canonicalToolNames = [
	"Read",
	"Write",
	"Edit",
	"Glob",
	"Grep",
	"Bash",
	"Skill",
	"UpdateTodos",
	"SpawnAgent",
] as const;
export const canonicalToolNameSchema = Type.Union(canonicalToolNames.map((name) => Type.Literal(name)));

export type CanonicalToolName = (typeof canonicalToolNames)[number];
export type PermissionEffect = "allow" | "ask" | "deny";
export type PermissionMode = "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";
export type PermissionAction = PermissionEffect;
export type PermissionRuleValue = PermissionAction | Readonly<Record<string, PermissionAction>>;
export type PermissionConfig = Readonly<Record<string, PermissionRuleValue>>;

export interface PermissionSettings {
	readonly permission?: PermissionConfig;
	readonly defaultMode?: PermissionMode;
	readonly allow?: readonly string[];
	readonly ask?: readonly string[];
	readonly deny?: readonly string[];
	readonly additionalDirectories?: readonly string[];
	readonly disableBypassPermissionsMode?: "disable";
}

export interface ResolvedPermissionSettings {
	readonly defaultMode: PermissionMode;
	readonly permission?: PermissionConfig;
	readonly allow: readonly string[];
	readonly ask: readonly string[];
	readonly deny: readonly string[];
	readonly additionalDirectories: readonly string[];
	readonly disableBypassPermissionsMode?: "disable";
}

export interface ParsedPermissionRule {
	readonly raw: string;
	readonly toolName: CanonicalToolName;
	readonly specifier?: string;
}

export interface PermissionCall {
	readonly toolName: CanonicalToolName;
	readonly args: Readonly<Record<string, unknown>>;
	readonly workspaceRoot: string;
}

export type PermissionDecisionSource = "rule" | "mode" | "built-in" | "danger-layer";

export interface PermissionDecision {
	readonly behavior: PermissionEffect;
	readonly source: PermissionDecisionSource;
	readonly rule?: string;
	readonly reason: string;
	readonly permission?: string;
	readonly patterns?: readonly string[];
	readonly alwaysPatterns?: readonly string[];
	readonly risk?: "normal" | "destructive" | "opaque";
}
