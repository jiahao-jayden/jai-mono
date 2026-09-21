import type { ShellExecutionPolicy } from "@jai/agent";
import { Result, type Result as ResultType } from "better-result";
import { executionPolicyUnsupportedError } from "./errors";
import { flattenPermissionConfig } from "./rules";
import type { PermissionAction, PermissionSettings } from "./types";

type FilePermissionAction = Extract<PermissionAction, "file.read" | "file.write">;

export interface ExecutionPolicyCompileInput {
	/** Must already be an absolute canonical workspace path selected by the host runtime. */
	readonly workspaceRoot: string;
	/** The current config revision; an adapter never reuses a policy across versions. */
	readonly version: string;
	readonly settings: PermissionSettings;
	/** Host-owned controls which a Shell must never read or alter. */
	readonly protectedPaths?: readonly string[];
	/** An explicit allowlist prepared by the Node adapter, never process.env itself. */
	readonly environment: Readonly<Record<string, string>>;
}

export type ExecutionPolicyCompileError = ReturnType<typeof executionPolicyUnsupportedError>;

/**
 * Converts the permission tree into the portable subset that an OS backend can
 * enforce continuously: literal paths and subtrees. General globs deliberately
 * fail rather than being expanded into a stale snapshot of current files.
 */
export function compileExecutionPolicy(
	input: ExecutionPolicyCompileInput,
): ResultType<ShellExecutionPolicy, ExecutionPolicyCompileError> {
	const workspaceRoot = normalizeAbsolutePath(input.workspaceRoot);
	if (!workspaceRoot) {
		return Result.err(
			executionPolicyUnsupportedError("file.read", input.workspaceRoot, "Workspace root must be absolute"),
		);
	}
	const read = compileFileRules("file.read", input.settings, workspaceRoot);
	if (read.isErr()) return read;
	const write = compileFileRules("file.write", input.settings, workspaceRoot);
	if (write.isErr()) return write;
	const protectedPaths = (input.protectedPaths ?? []).map(normalizeAbsolutePath).filter(isDefined);
	const writableRoots = input.settings.defaultMode === "plan" ? [] : unique([workspaceRoot, ...write.value.allowed]);
	return Result.ok(
		Object.freeze({
			version: input.version,
			workspaceRoot,
			writableRoots: Object.freeze(writableRoots),
			deniedReadPaths: Object.freeze(unique([...read.value.denied, ...protectedPaths])),
			deniedWritePaths: Object.freeze(unique([...write.value.denied, ...protectedPaths])),
			environment: Object.freeze({ ...input.environment }),
		}),
	);
}

function compileFileRules(
	action: FilePermissionAction,
	settings: PermissionSettings,
	workspaceRoot: string,
): ResultType<
	{ readonly allowed: readonly string[]; readonly denied: readonly string[] },
	ExecutionPolicyCompileError
> {
	const allowed: string[] = [];
	const denied: string[] = [];
	for (const rule of flattenPermissionConfig(settings.permission)) {
		if (rule.permission !== action) continue;
		const path = resolveEnforceablePath(rule.pattern, workspaceRoot);
		if (path.isErr()) return Result.err(executionPolicyUnsupportedError(action, rule.pattern, path.error));
		if (rule.action === "allow") allowed.push(path.value);
		else denied.push(path.value);
	}
	return Result.ok({ allowed: unique(allowed), denied: unique(denied) });
}

function resolveEnforceablePath(pattern: string, workspaceRoot: string): ResultType<string, string> {
	const normalizedPattern = pattern.endsWith("/**") ? pattern.slice(0, -3) : pattern;
	if (!normalizedPattern || normalizedPattern === "*" || /[*?[]/.test(normalizedPattern)) {
		return Result.err("Only literal paths and /** subtrees can be enforced for Shell execution");
	}
	if (normalizedPattern.startsWith("~"))
		return Result.err("Home-relative paths cannot be enforced without an explicit absolute path");
	if (!normalizedPattern || normalizedPattern.split("/").includes("..")) {
		return Result.err("Parent traversal cannot be compiled into an execution policy");
	}
	const absolute = normalizedPattern.startsWith("//")
		? `/${normalizedPattern.slice(2)}`
		: normalizedPattern.startsWith("/")
			? `${workspaceRoot}/${normalizedPattern.slice(1)}`
			: `${workspaceRoot}/${normalizedPattern.replace(/^\.\//, "")}`;
	const resolved = normalizeAbsolutePath(absolute);
	return resolved ? Result.ok(resolved) : Result.err("Path is not an absolute literal");
}

function normalizeAbsolutePath(path: string): string | undefined {
	if (!path.startsWith("/")) return undefined;
	const parts: string[] = [];
	for (const part of path.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") return undefined;
		parts.push(part);
	}
	return `/${parts.join("/")}`;
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}

function isDefined<T>(value: T | undefined): value is T {
	return value !== undefined;
}
