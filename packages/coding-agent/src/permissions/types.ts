import { Type } from "@sinclair/typebox";

export const canonicalToolNames = ["Read", "Write", "Edit", "Bash"] as const;
export const canonicalToolNameSchema = Type.Union(canonicalToolNames.map((name) => Type.Literal(name)));

export type CanonicalToolName = (typeof canonicalToolNames)[number];
export type PermissionEffect = "allow" | "ask" | "deny";
/** `auto` lets the Host's reviewer answer built-in asks before the user. */
export type PermissionMode = "ask" | "allow" | "auto" | "plan";

export const permissionActions = ["file.read", "file.write", "process.exec", "tool.invoke"] as const;
export type PermissionAction = (typeof permissionActions)[number];

export function isPermissionAction(value: unknown): value is PermissionAction {
	return permissionActions.includes(value as PermissionAction);
}

export type PermissionRuleValue = PermissionEffect | Readonly<Record<string, PermissionEffect>>;
export type PermissionConfig = Readonly<Partial<Record<PermissionAction, PermissionRuleValue>>>;
export type PermissionGrantConfig = Readonly<Record<string, PermissionConfig>>;

export interface PermissionSettings {
	readonly permission?: PermissionConfig;
	readonly sessionGrants?: PermissionConfig;
	readonly permissionGrants?: PermissionGrantConfig;
	readonly defaultMode?: PermissionMode;
	readonly additionalDirectories?: readonly string[];
}

export interface ResolvedPermissionSettings {
	readonly defaultMode: PermissionMode;
	readonly permission?: PermissionConfig;
	readonly sessionGrants?: PermissionConfig;
	readonly permissionGrants?: PermissionGrantConfig;
	readonly additionalDirectories: readonly string[];
}

export interface PermissionPathResource {
	readonly kind: "path";
	readonly path: string;
}

export interface PermissionCommandResource {
	readonly kind: "command";
	readonly command: string;
}

/** Stable catalog identity; operation-local tool refs never enter durable rules. */
export interface PermissionToolResource {
	readonly kind: "tool";
	readonly identity: string;
}

export type PermissionResource = PermissionPathResource | PermissionCommandResource | PermissionToolResource;

/** A validated authorization fact. One tool call can produce several targets. */
export interface PermissionTarget {
	readonly toolName: string;
	readonly action: PermissionAction;
	readonly resource: PermissionResource;
	readonly risk?: "destructive" | "opaque";
}

/** The only input accepted by the pure permission evaluator. */
export interface PermissionRequest {
	readonly workspaceRoot: string;
	readonly targets: readonly PermissionTarget[];
}

export type PermissionDecisionSource =
	| "rule"
	| "session-grant"
	| "project-grant"
	| "mode"
	| "built-in"
	| "danger-layer";

export interface PermissionDecision {
	readonly behavior: PermissionEffect;
	readonly source: PermissionDecisionSource;
	readonly rule?: string;
	readonly reason: string;
	readonly permission?: PermissionAction;
	readonly patterns?: readonly string[];
	readonly alwaysPatterns?: readonly string[];
	readonly risk?: "normal" | "destructive" | "opaque";
}
