import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import type {
	AgentToolResult,
	PathCapability,
	PathCapabilityManager,
	ResolvePathOptions,
	ToolMiddleware,
} from "@jai/agent";
import type { JsonObject } from "../core/json";
import type { PermissionApprovalDecision, PermissionRequestSummary, PermissionRisk } from "./approval";
import { bashPermissionScanArgument, scanBashCommand } from "./bash-parser";
import { permissionAbortedError, permissionApprovalUnavailableError, permissionDeniedError } from "./errors";
import { evaluatePermission } from "./evaluate";
import { bashAlwaysPattern } from "./rules";
import type { CodingExtensionToolCall, CodingToolPermission } from "./tool-permission";
import { type CanonicalToolName, canonicalToolNames, type PermissionDecision, type PermissionSettings } from "./types";

export interface PermissionApprovalRequest {
	readonly requestId: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly args: Readonly<Record<string, unknown>>;
	readonly reason: string;
	readonly canAlwaysAllow: boolean;
	/**
	 * Safe, host-renderable description of what is being asked for. Built here
	 * because this is where the decision and the arguments are both in hand.
	 */
	readonly summary: PermissionRequestSummary;
	readonly suggestedRule?: string;
	readonly suggestedRules?: readonly string[];
	readonly rememberScope?: "session" | "project-local";
}

export interface PermissionMiddlewareOptions {
	readonly workspaceRoot: string | (() => string);
	readonly settings: PermissionSettings | (() => PermissionSettings | Promise<PermissionSettings>);
	readonly extensionToolPermissions?: ReadonlyMap<string, ExtensionToolPermissionResolver>;
	/**
	 * Permission resolvers owned by the runtime itself rather than by an Extension. Kept separate from
	 * `extensionToolPermissions` because that map is rebuilt (cleared and refilled) during Extension
	 * activation, which would otherwise drop entries the runtime registered before activation ran.
	 */
	readonly coreToolPermissions?: ReadonlyMap<string, ExtensionToolPermissionResolver>;
	/** Extension tools which explicitly own their authorization transaction. */
	readonly extensionAuthorizedToolNames?: ReadonlySet<string>;
	readonly requestApproval?: (
		request: PermissionApprovalRequest,
		signal?: AbortSignal,
	) => PermissionApprovalDecision | Promise<PermissionApprovalDecision>;
	readonly persistProjectLocalAllowRules?: (rules: readonly string[]) => void | Promise<void>;
	readonly pathCapabilities?: PathCapabilityManager;
	readonly sessionAllowRules?: Set<string>;
}

export function createPermissionMiddleware(options: PermissionMiddlewareOptions): ToolMiddleware {
	const sessionAllowRules = options.sessionAllowRules ?? new Set<string>();
	return async (context, next) => {
		if (options.extensionAuthorizedToolNames?.has(context.tool.name)) return next();
		const extensionPermission =
			options.coreToolPermissions?.get(context.tool.name) ??
			options.extensionToolPermissions?.get(context.tool.name);
		if (extensionPermission) {
			return evaluateExtensionPermission(
				context.tool.name,
				context.args,
				extensionPermission,
				await currentSettings(options.settings),
				options.requestApproval,
				context.toolCall.id,
				context.signal,
				next,
			);
		}
		const toolName = canonicalToolName(context.tool.name);
		const workspaceRoot = currentWorkspaceRoot(options.workspaceRoot);
		const settings = await currentSettings(options.settings);
		const effective = withSessionRules(settings, sessionAllowRules);
		const permissionArgs = await argsForPermission(toolName, context.args);
		const call = { toolName, args: permissionArgs, workspaceRoot };
		const initial = evaluatePermission(call, effective);
		if (initial.behavior === "deny") throw permissionDeniedError(toolName, initial.reason);
		const capability = await createPathCapability(
			options.pathCapabilities,
			toolName,
			permissionArgs,
			workspaceRoot,
			context.signal,
		);
		const canonicalDecision = capability
			? evaluatePermission(canonicalCall(call, capability.canonicalPath), effective)
			: initial;
		if (canonicalDecision.behavior === "deny") {
			throw permissionDeniedError(toolName, canonicalDecision.reason);
		}
		if (initial.behavior === "allow" && canonicalDecision.behavior === "allow") {
			return capability && options.pathCapabilities
				? options.pathCapabilities.withPathCapability(capability, next)
				: next();
		}
		if (!options.requestApproval) throw permissionApprovalUnavailableError(toolName);
		if (context.signal?.aborted) throw permissionAbortedError(toolName);

		const suggested = suggestedRules(toolName, context.args, workspaceRoot, initial);
		const decided = canonicalDecision.behavior === "ask" ? canonicalDecision : initial;
		const request: PermissionApprovalRequest = {
			requestId: randomUUID(),
			toolCallId: context.toolCall.id,
			toolName,
			args: structuredClone(context.args),
			reason: initial.behavior === "ask" ? initial.reason : canonicalDecision.reason,
			canAlwaysAllow: Boolean(suggested),
			summary: approvalSummary(toolName, permissionArgs, decided),
			...(suggested
				? {
						suggestedRule: suggested.rules[0],
						suggestedRules: suggested.rules,
						rememberScope: suggested.scope,
					}
				: {}),
		};
		const approval = await options.requestApproval(request, context.signal);
		if (context.signal?.aborted) throw permissionAbortedError(toolName);
		if (approval === "deny") throw permissionDeniedError(toolName, "User denied the permission request");
		if (approval === "alwaysAllow" && !suggested) {
			throw permissionDeniedError(toolName, "Always allow is unavailable for this permission request");
		}

		const currentRoot = currentWorkspaceRoot(options.workspaceRoot);
		const current = await currentSettings(options.settings);
		const rechecked = evaluatePermission(
			{ toolName, args: permissionArgs, workspaceRoot: currentRoot },
			withSessionRules(current, sessionAllowRules),
		);
		const canonicalRechecked = capability
			? evaluatePermission(
					canonicalCall({ toolName, args: permissionArgs, workspaceRoot: currentRoot }, capability.canonicalPath),
					withSessionRules(current, sessionAllowRules),
				)
			: rechecked;
		if (currentRoot !== workspaceRoot || rechecked.behavior === "deny" || canonicalRechecked.behavior === "deny") {
			throw permissionDeniedError(toolName, "Permission context changed while awaiting approval");
		}

		if (approval === "alwaysAllow" && suggested) {
			if (suggested.scope === "session") {
				for (const rule of suggested.rules) sessionAllowRules.add(rule);
				if (capability) {
					const canonicalSuggested = suggestedRules(
						toolName,
						argsWithPath(toolName, context.args, capability.canonicalPath),
						workspaceRoot,
						canonicalDecision,
					);
					if (canonicalSuggested) {
						for (const rule of canonicalSuggested.rules) sessionAllowRules.add(rule);
					}
				}
			} else if (options.persistProjectLocalAllowRules) {
				await options.persistProjectLocalAllowRules(suggested.rules);
			}
		}
		return capability && options.pathCapabilities
			? options.pathCapabilities.withPathCapability(capability, next)
			: next();
	};
}

export type ExtensionToolPermissionResolver = (
	call: CodingExtensionToolCall<JsonObject>,
) => CodingToolPermission | Promise<CodingToolPermission>;

async function evaluateExtensionPermission(
	toolName: string,
	args: Record<string, unknown>,
	resolvePermission: ExtensionToolPermissionResolver,
	settings: PermissionSettings,
	requestApproval: PermissionMiddlewareOptions["requestApproval"],
	toolCallId: string,
	signal: AbortSignal | undefined,
	next: () => Promise<AgentToolResult>,
): Promise<AgentToolResult> {
	const permission = await resolvePermission({
		toolCallId,
		args: structuredClone(args) as JsonObject,
		...(signal ? { signal } : {}),
	});
	if (
		(permission.sideEffect !== "read" &&
			permission.sideEffect !== "write" &&
			permission.sideEffect !== "destructive") ||
		(permission.dataSensitivity !== undefined &&
			permission.dataSensitivity !== "normal" &&
			permission.dataSensitivity !== "sensitive" &&
			permission.dataSensitivity !== "secret") ||
		!permission.reason.trim()
	) {
		throw permissionDeniedError(toolName, "Extension supplied an invalid permission description");
	}
	const mode = settings.defaultMode ?? "default";
	if (mode === "plan" && permission.sideEffect !== "read") {
		throw permissionDeniedError(toolName, "Plan mode only allows read-only work");
	}
	if (mode === "dontAsk") {
		throw permissionDeniedError(toolName, "Don't Ask denies Extension tools without an Allow rule");
	}
	const needsApproval =
		permission.sideEffect === "destructive" ||
		(mode !== "bypassPermissions" &&
			(permission.sideEffect === "write" ||
				permission.dataSensitivity === "sensitive" ||
				permission.dataSensitivity === "secret"));
	if (!needsApproval) return next();
	if (!requestApproval)
		throw permissionDeniedError(toolName, "No approval handler is configured for this Extension tool");
	if (signal?.aborted) throw permissionAbortedError(toolName);
	const approval = await requestApproval(
		{
			requestId: randomUUID(),
			toolCallId,
			toolName,
			args: structuredClone(args),
			reason: permission.reason,
			canAlwaysAllow: false,
			summary: {
				title: `${toolName} requests permission`,
				description: permission.reason,
				risk: permission.sideEffect === "destructive" ? "high" : "medium",
			},
		},
		signal,
	);
	if (signal?.aborted) throw permissionAbortedError(toolName);
	if (approval !== "allowOnce") throw permissionDeniedError(toolName, "User denied the permission request");
	return next();
}

async function argsForPermission(
	toolName: CanonicalToolName,
	args: Readonly<Record<string, unknown>>,
): Promise<Readonly<Record<string, unknown>>> {
	if (toolName !== "Bash") return args;
	const scan = await scanBashCommand(stringArg(args, "command"));
	return {
		...args,
		[bashPermissionScanArgument]: scan.isOk()
			? scan.value
			: { patterns: [], alwaysPatterns: [], destructive: false, opaque: true },
	};
}

function canonicalCall(
	call: { toolName: CanonicalToolName; args: Readonly<Record<string, unknown>>; workspaceRoot: string },
	canonicalPath: string,
) {
	return { ...call, args: argsWithPath(call.toolName, call.args, canonicalPath) };
}

function argsWithPath(
	toolName: CanonicalToolName,
	args: Readonly<Record<string, unknown>>,
	path: string,
): Readonly<Record<string, unknown>> {
	return toolPath(toolName, args) === undefined ? args : { ...args, path };
}

async function createPathCapability(
	manager: PathCapabilityManager | undefined,
	toolName: CanonicalToolName,
	args: Readonly<Record<string, unknown>>,
	workspaceRoot: string,
	signal?: AbortSignal,
): Promise<PathCapability | undefined> {
	if (!manager) return undefined;
	const path = toolPath(toolName, args);
	if (path === undefined) return undefined;
	const options = pathResolveOptions(toolName, workspaceRoot, signal);
	return manager.createPathCapability(path, options);
}

function toolPath(toolName: CanonicalToolName, args: Readonly<Record<string, unknown>>): string | undefined {
	if (toolName === "Glob" || toolName === "Grep") return stringArg(args, "path") || ".";
	if (toolName === "Read" || toolName === "Write" || toolName === "Edit") return stringArg(args, "path");
	return undefined;
}

function pathResolveOptions(
	toolName: CanonicalToolName,
	workspaceRoot: string,
	signal?: AbortSignal,
): ResolvePathOptions {
	return {
		base: workspaceRoot,
		boundary: workspaceRoot,
		mustExist: toolName !== "Write",
		...(toolName === "Read" || toolName === "Edit"
			? { expectedKind: "file" as const }
			: toolName === "Glob"
				? { expectedKind: "directory" as const }
				: {}),
		signal,
	};
}

function canonicalToolName(value: string): CanonicalToolName {
	if ((canonicalToolNames as readonly string[]).includes(value)) return value as CanonicalToolName;
	throw permissionDeniedError(value, "Tool has no registered permission policy");
}

/**
 * Projects the decision and the call into the approval summary a host renders.
 * The risk comes from the evaluator's own classification — the Danger Layer
 * marks destructive and opaque operations — rather than from the tool name.
 */
function approvalSummary(
	toolName: CanonicalToolName,
	args: Readonly<Record<string, unknown>>,
	decision: PermissionDecision,
): PermissionRequestSummary {
	const path = stringArgument(args, "path");
	const command = toolName === "Bash" ? stringArgument(args, "command") : undefined;
	return {
		title: `${toolName} requests permission`,
		...(command ? { command } : {}),
		...(path ? { path } : {}),
		risk: riskOf(decision),
	};
}

function riskOf(decision: PermissionDecision): PermissionRisk {
	switch (decision.risk) {
		case "destructive":
		case "opaque":
			return "high";
		case "normal":
			return "medium";
		default:
			return decision.source === "danger-layer" ? "high" : "medium";
	}
}

function stringArgument(args: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" && value ? value : undefined;
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

function suggestedRules(
	toolName: CanonicalToolName,
	args: Readonly<Record<string, unknown>>,
	workspaceRoot: string,
	decision: { readonly source: string; readonly alwaysPatterns?: readonly string[] },
): { readonly rules: readonly string[]; readonly scope: "session" | "project-local" } | undefined {
	if (decision.source === "danger-layer") return undefined;
	if (toolName === "Bash") {
		const command = stringArg(args, "command");
		const patterns = decision.alwaysPatterns ?? (command ? [bashAlwaysPattern(command)].filter(Boolean) : []);
		const rules = unique(patterns.map((pattern) => `bash:${pattern}`));
		return rules.length > 0 ? { rules, scope: "project-local" } : undefined;
	}
	if (toolName === "Write" || toolName === "Edit") {
		const path = absolutePath(args, workspaceRoot);
		return path ? { rules: [`Edit(${rootPath(path)})`], scope: "session" } : undefined;
	}
	if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") {
		const path = absolutePath(args, workspaceRoot, toolName === "Glob" || toolName === "Grep");
		return path ? { rules: [`Read(${rootPath(path)})`], scope: "session" } : undefined;
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

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}
