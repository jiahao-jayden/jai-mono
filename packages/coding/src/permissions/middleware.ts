import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import type { ToolMiddleware } from "@jai/agent";
import { permissionAbortedError, permissionApprovalUnavailableError, permissionDeniedError } from "./errors";
import { evaluatePermission } from "./evaluate";
import { type CanonicalToolName, canonicalToolNames, type PermissionSettings } from "./types";

export type PermissionApprovalDecision = "deny" | "allowOnce" | "alwaysAllow";

export interface PermissionApprovalRequest {
	readonly requestId: string;
	readonly toolCallId: string;
	readonly toolName: CanonicalToolName;
	readonly args: Readonly<Record<string, unknown>>;
	readonly reason: string;
	readonly suggestedRule?: string;
	readonly rememberScope?: "session" | "project-local";
}

export interface PermissionMiddlewareOptions {
	readonly workspaceRoot: string | (() => string);
	readonly settings: PermissionSettings | (() => PermissionSettings | Promise<PermissionSettings>);
	readonly requestApproval?: (
		request: PermissionApprovalRequest,
		signal?: AbortSignal,
	) => PermissionApprovalDecision | Promise<PermissionApprovalDecision>;
	readonly persistProjectLocalAllowRule?: (rule: string) => void | Promise<void>;
}

export function createPermissionMiddleware(options: PermissionMiddlewareOptions): ToolMiddleware {
	const sessionAllowRules = new Set<string>();
	return async (context, next) => {
		const toolName = canonicalToolName(context.tool.name);
		const workspaceRoot = currentWorkspaceRoot(options.workspaceRoot);
		const settings = await currentSettings(options.settings);
		const effective = withSessionRules(settings, sessionAllowRules);
		const call = { toolName, args: context.args, workspaceRoot };
		const initial = evaluatePermission(call, effective);
		if (initial.behavior === "allow") return next();
		if (initial.behavior === "deny") throw permissionDeniedError(toolName, initial.reason);
		if (!options.requestApproval) throw permissionApprovalUnavailableError(toolName);
		if (context.signal?.aborted) throw permissionAbortedError(toolName);

		const suggested = suggestedRule(toolName, context.args, workspaceRoot);
		const request: PermissionApprovalRequest = {
			requestId: randomUUID(),
			toolCallId: context.toolCall.id,
			toolName,
			args: structuredClone(context.args),
			reason: initial.reason,
			...(suggested ? { suggestedRule: suggested.rule, rememberScope: suggested.scope } : {}),
		};
		const approval = await options.requestApproval(request, context.signal);
		if (context.signal?.aborted) throw permissionAbortedError(toolName);
		if (approval === "deny") throw permissionDeniedError(toolName, "User denied the permission request");

		const currentRoot = currentWorkspaceRoot(options.workspaceRoot);
		const current = await currentSettings(options.settings);
		const rechecked = evaluatePermission(
			{ toolName, args: context.args, workspaceRoot: currentRoot },
			withSessionRules(current, sessionAllowRules),
		);
		if (currentRoot !== workspaceRoot || rechecked.behavior === "deny") {
			throw permissionDeniedError(toolName, "Permission context changed while awaiting approval");
		}

		if (approval === "alwaysAllow" && suggested) {
			if (suggested.scope === "session") sessionAllowRules.add(suggested.rule);
			else await options.persistProjectLocalAllowRule?.(suggested.rule);
		}
		return next();
	};
}

function canonicalToolName(value: string): CanonicalToolName {
	if ((canonicalToolNames as readonly string[]).includes(value)) return value as CanonicalToolName;
	throw permissionDeniedError(value, "Tool has no registered permission policy");
}

function currentWorkspaceRoot(value: string | (() => string)): string {
	return resolve(typeof value === "function" ? value() : value);
}

async function currentSettings(
	value: PermissionSettings | (() => PermissionSettings | Promise<PermissionSettings>),
): Promise<PermissionSettings> {
	return typeof value === "function" ? value() : value;
}

function withSessionRules(settings: PermissionSettings, sessionRules: ReadonlySet<string>): PermissionSettings {
	return sessionRules.size === 0 ? settings : { ...settings, allow: [...(settings.allow ?? []), ...sessionRules] };
}

function suggestedRule(
	toolName: CanonicalToolName,
	args: Readonly<Record<string, unknown>>,
	workspaceRoot: string,
): { readonly rule: string; readonly scope: "session" | "project-local" } | undefined {
	if (toolName === "Bash") {
		const command = stringArg(args, "command");
		return command ? { rule: `Bash(${command})`, scope: "project-local" } : undefined;
	}
	if (toolName === "Write" || toolName === "Edit") {
		const path = absolutePath(args, workspaceRoot);
		return path ? { rule: `Edit(${rootPath(path)})`, scope: "session" } : undefined;
	}
	if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") {
		const path = absolutePath(args, workspaceRoot, toolName === "Glob" || toolName === "Grep");
		return path ? { rule: `Read(${rootPath(path)})`, scope: "session" } : undefined;
	}
	return undefined;
}

function absolutePath(
	args: Readonly<Record<string, unknown>>,
	workspaceRoot: string,
	defaultCurrent = false,
): string | undefined {
	const input = stringArg(args, "path") || (defaultCurrent ? "." : "");
	if (!input) return undefined;
	const path = isAbsolute(input) ? resolve(input) : resolve(workspaceRoot, input);
	return escapePattern(path);
}

function rootPath(path: string): string {
	return `//${path.replace(/^\/+/, "")}`;
}

function escapePattern(path: string): string {
	return path.replaceAll("\\", "/").replace(/([*?[\]])/g, "[$1]");
}

function stringArg(args: Readonly<Record<string, unknown>>, key: string): string {
	const value = args[key];
	return typeof value === "string" ? value : "";
}
