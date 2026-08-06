import { Type } from "@sinclair/typebox";

export const canonicalToolNames = [
	"Read",
	"Write",
	"Edit",
	"Glob",
	"Grep",
	"Bash",
	"Skill",
	"ReportProgress",
	"UpdateTodos",
	"SpawnAgent",
] as const;
export const canonicalToolNameSchema = Type.Union(canonicalToolNames.map((name) => Type.Literal(name)));

export type CanonicalToolName = (typeof canonicalToolNames)[number];
export type PermissionEffect = "allow" | "ask" | "deny";
export type PermissionMode = "default" | "acceptEdits" | "plan" | "dontAsk" | "bypassPermissions";

export interface PermissionSettings {
	readonly defaultMode?: PermissionMode;
	readonly allow?: readonly string[];
	readonly ask?: readonly string[];
	readonly deny?: readonly string[];
	readonly additionalDirectories?: readonly string[];
	readonly disableBypassPermissionsMode?: "disable";
}

export interface ResolvedPermissionSettings {
	readonly defaultMode: PermissionMode;
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

export type PermissionDecisionSource = "rule" | "mode" | "built-in";

export interface PermissionDecision {
	readonly behavior: PermissionEffect;
	readonly source: PermissionDecisionSource;
	readonly rule?: string;
	readonly reason: string;
}
