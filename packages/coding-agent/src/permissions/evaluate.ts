import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { bashScanFromArgs } from "./bash-parser";
import { normalizePermissionSettings } from "./definition";
import { invalidPermissionCallError } from "./errors";
import {
	bashAlwaysPattern,
	commandBasename,
	executableIndex,
	findExecutesCommands,
	flattenPermissionConfig,
	isDestructiveBashCommand,
	matchesPermissionConfigRule,
	splitBashCommand,
} from "./rules";
import {
	type CanonicalToolName,
	isPermissionAction,
	type PermissionAction,
	type PermissionDecision,
	type PermissionEffect,
	type PermissionRequest,
	type PermissionSettings,
	type PermissionTarget,
	type ResolvedPermissionSettings,
} from "./types";

const readOnlyCommands = new Set([
	"cat",
	"cd",
	"diff",
	"du",
	"echo",
	"find",
	"grep",
	"head",
	"ls",
	"pwd",
	"rg",
	"sleep",
	"stat",
	"tail",
	"wc",
	"which",
]);
const readOnlyGitCommands = new Set(["branch", "diff", "log", "show", "status"]);
const strippedWrappers = new Set(["builtin", "command", "nice", "noglob", "nohup", "stdbuf", "time", "timeout"]);

/** Converts validated tool arguments into stable resource targets before any policy is evaluated. */
export function createPermissionRequest(
	toolName: string,
	args: Readonly<Record<string, unknown>>,
	workspaceRoot: string,
): PermissionRequest {
	const canonical = canonicalToolName(toolName);
	if (!isAbsolute(workspaceRoot)) throw invalidPermissionCallError(toolName, "workspaceRoot must be absolute");
	if (canonical === "Bash") {
		const command = stringArg(args, "command");
		if (!command) throw invalidPermissionCallError(toolName, "Bash permission calls require command");
		return { workspaceRoot, targets: bashTargets(canonical, command, bashScanFromArgs(args)) };
	}
	const path = stringArg(args, "path");
	if (!path) throw invalidPermissionCallError(toolName, `${canonical} permission calls require path`);
	return {
		workspaceRoot,
		targets: [
			{
				toolName: canonical,
				action: canonical === "Read" ? "file.read" : "file.write",
				resource: { kind: "path", path },
			},
		],
	};
}

/** Builds a stable permission target for a validated catalog tool. */
export function createExtensionPermissionRequest(
	toolName: string,
	workspaceRoot: string,
	risk?: "destructive",
): PermissionRequest {
	if (!toolName.trim())
		throw invalidPermissionCallError(toolName, "Extension permission calls require a tool identity");
	if (!isAbsolute(workspaceRoot)) throw invalidPermissionCallError(toolName, "workspaceRoot must be absolute");
	return {
		workspaceRoot,
		targets: [
			{
				toolName,
				action: "tool.invoke",
				resource: { kind: "tool", identity: toolName },
				risk,
			},
		],
	};
}

export function evaluatePermission(
	request: PermissionRequest,
	settings: PermissionSettings | ResolvedPermissionSettings = {},
): PermissionDecision {
	const resolved = normalizePermissionSettings(settings);
	validateRequest(request);
	const decisions = request.targets.map((target) => evaluateTarget(request, target, resolved));
	return aggregateDecisions(request.targets, decisions);
}

function evaluateTarget(
	request: PermissionRequest,
	target: PermissionTarget,
	settings: ResolvedPermissionSettings,
): PermissionDecision {
	const rule = matchingRule(settings.permission, target, request.workspaceRoot);
	const projectGrant = matchingRule(
		settings.permissionGrants?.[canonicalWorkspaceRoot(request.workspaceRoot)],
		target,
		request.workspaceRoot,
	);
	const grant = projectGrant ?? matchingRule(settings.sessionGrants, target, request.workspaceRoot);
	if (rule?.action === "deny") return ruleDecision(target, rule);
	if (settings.defaultMode === "bypassPermissions" && settings.disableBypassPermissionsMode === "disable") {
		return decision("deny", "mode", "Bypass Permissions is disabled by configuration", target);
	}
	if (settings.defaultMode === "plan" && !isReadOnlyTarget(target)) {
		return decision("deny", "mode", "Plan mode only allows read-only work", target);
	}
	if (target.resource.kind === "command" && isCircuitBreakerCommand(target.resource.command)) {
		return decision("deny", "danger-layer", "Deleting the filesystem root or home directory is not allowed", target, {
			risk: "destructive",
		});
	}
	if (
		target.risk === "destructive" ||
		(target.resource.kind === "command" && isDestructiveBashCommand(target.resource.command))
	) {
		if (settings.defaultMode === "dontAsk") {
			return decision("deny", "mode", "Don't Ask denies risky calls without a matching Allow rule", target);
		}
		return decision("ask", "danger-layer", "Destructive Bash operation requires approval", target, {
			risk: "destructive",
		});
	}
	if (target.risk === "opaque") {
		if (settings.defaultMode === "dontAsk") {
			return decision("deny", "mode", "Don't Ask denies opaque calls without a matching Allow rule", target);
		}
		return decision("ask", "danger-layer", "Permission target could not be parsed safely", target, {
			risk: "opaque",
		});
	}
	if (rule?.action === "ask" && grant?.action === "allow") {
		return ruleDecision(target, grant, projectGrant ? "project-grant" : "session-grant");
	}
	if (rule) return ruleDecision(target, rule);
	if (grant?.action === "allow") {
		return ruleDecision(target, grant, projectGrant ? "project-grant" : "session-grant");
	}
	if (settings.defaultMode === "dontAsk") {
		return decision("deny", "mode", "Don't Ask denies calls without a matching Allow rule", target);
	}
	if (settings.defaultMode === "bypassPermissions")
		return decision("allow", "mode", "Bypass Permissions mode", target);
	return builtInDecision(request, target, settings);
}

function builtInDecision(
	request: PermissionRequest,
	target: PermissionTarget,
	settings: ResolvedPermissionSettings,
): PermissionDecision {
	if (target.action === "file.read") {
		return isInsideReadableBoundary(request.workspaceRoot, target.resource, settings.additionalDirectories)
			? decision("allow", "built-in", "Read is inside the workspace boundary", target)
			: decision("ask", "built-in", "Read is outside the workspace boundary", target);
	}
	if (target.action === "file.write") {
		if (
			settings.defaultMode === "acceptEdits" &&
			isInsideReadableBoundary(request.workspaceRoot, target.resource, settings.additionalDirectories)
		) {
			return decision("allow", "mode", "Accept Edits allows changes inside the workspace boundary", target);
		}
		return decision("ask", "built-in", "File modifications require confirmation", target);
	}
	if (target.action === "tool.invoke") {
		return decision("ask", "built-in", `No tool permission rule matched for: ${resourceText(target)}`, target);
	}
	if (target.resource.kind === "command" && isReadOnlySubcommand(target.resource.command)) {
		return decision("allow", "built-in", "Built-in safe Bash command", target);
	}
	return decision("ask", "built-in", `No process permission rule matched for: ${resourceText(target)}`, target);
}

function matchingRule(
	config: PermissionSettings["permission"] | undefined,
	target: PermissionTarget,
	workspaceRoot: string,
) {
	const matches = flattenPermissionConfig(config).filter((rule) =>
		matchesPermissionConfigRule(rule, target, workspaceRoot),
	);
	return (
		matches.find((rule) => rule.action === "deny") ??
		matches.find((rule) => rule.action === "ask") ??
		matches.find((rule) => rule.action === "allow")
	);
}

function ruleDecision(
	target: PermissionTarget,
	rule: { readonly permission: PermissionAction; readonly pattern: string; readonly action: PermissionEffect },
	source: "rule" | "session-grant" | "project-grant" = "rule",
): PermissionDecision {
	return decision(rule.action, source, `Matched ${rule.action} permission rule`, target, {
		rule: `${rule.permission}:${rule.pattern}`,
	});
}

function aggregateDecisions(
	targets: readonly PermissionTarget[],
	decisions: readonly PermissionDecision[],
): PermissionDecision {
	const selected =
		decisions.find((item) => item.behavior === "deny") ??
		decisions.find((item) => item.behavior === "ask") ??
		decisions[0]!;
	const commandTargets = targets.filter((target) => target.resource.kind === "command");
	const patterns = commandTargets.map((target) => (target.resource.kind === "command" ? target.resource.command : ""));
	const askedCommands = commandTargets.filter((_target, index) => decisions[index]?.behavior === "ask");
	const alwaysPatterns = unique(
		askedCommands.flatMap((target) =>
			target.resource.kind === "command"
				? [bashAlwaysPattern(target.resource.command) ?? `${target.resource.command} *`]
				: [],
		),
	);
	return {
		...selected,
		patterns: patterns.length > 0 ? patterns : selected.patterns,
		alwaysPatterns: alwaysPatterns.length > 0 ? alwaysPatterns : selected.alwaysPatterns,
	};
}

function validateRequest(request: PermissionRequest): void {
	if (!isAbsolute(request.workspaceRoot))
		throw invalidPermissionCallError("unknown", "workspaceRoot must be absolute");
	if (request.targets.length === 0)
		throw invalidPermissionCallError("unknown", "Permission request must contain at least one target");
	for (const target of request.targets) {
		if (!target.toolName.trim())
			throw invalidPermissionCallError("unknown", "Permission target tool must not be empty");
		if (!isPermissionAction(target.action)) {
			throw invalidPermissionCallError(target.toolName, `Unknown permission action: ${String(target.action)}`);
		}
		if (!target.resource || typeof target.resource !== "object") {
			throw invalidPermissionCallError(target.toolName, "Permission target requires a resource");
		}
		if (target.resource.kind === "path" && !target.resource.path)
			throw invalidPermissionCallError(target.toolName, "Path target must not be empty");
		if (target.resource.kind === "command" && !target.resource.command)
			throw invalidPermissionCallError(target.toolName, "Command target must not be empty");
		if (target.resource.kind === "tool" && !target.resource.identity)
			throw invalidPermissionCallError(target.toolName, "Tool target must not be empty");
		if (target.resource.kind !== "path" && target.resource.kind !== "command" && target.resource.kind !== "tool") {
			throw invalidPermissionCallError(target.toolName, "Unknown permission resource kind");
		}
	}
}

function bashTargets(
	toolName: CanonicalToolName,
	command: string,
	scan: ReturnType<typeof bashScanFromArgs>,
): PermissionTarget[] {
	const patterns = scan?.patterns.length ? scan.patterns : (splitBashCommand(command) ?? [command]);
	return patterns.map((value) => ({
		toolName,
		action: "process.exec",
		resource: { kind: "command", command: value },
		risk: scan?.opaque
			? ("opaque" as const)
			: scan?.destructive || isDestructiveBashCommand(value)
				? ("destructive" as const)
				: undefined,
	}));
}

function isReadOnlyTarget(target: PermissionTarget): boolean {
	if (target.action === "file.read") return true;
	return (
		target.action === "process.exec" &&
		target.resource.kind === "command" &&
		isReadOnlySubcommand(target.resource.command)
	);
}

function isInsideReadableBoundary(
	workspaceRoot: string,
	resource: PermissionTarget["resource"],
	additionalDirectories: readonly string[],
): boolean {
	if (resource.kind !== "path") return false;
	const target = resolve(workspaceRoot, resource.path);
	const roots = [
		resolve(workspaceRoot),
		...additionalDirectories.map((directory) =>
			isAbsolute(directory) ? resolve(directory) : resolve(workspaceRoot, directory),
		),
	];
	return roots.some((root) => isWithin(root, target));
}

function isWithin(root: string, target: string): boolean {
	const fromRoot = relative(root, target);
	return fromRoot === "" || (!isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`));
}

function isReadOnlySubcommand(command: string): boolean {
	if (command.includes("$(") || command.includes("`") || /(^|[^<])>(?!>)/.test(command) || />>|<\(|>\(/.test(command))
		return false;
	const tokens = shellWords(command);
	if (!tokens || tokens.length === 0) return false;
	let index = 0;
	while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]!)) index++;
	while (strippedWrappers.has(tokens[index] ?? "")) {
		const wrapper = tokens[index++];
		if (wrapper === "timeout" && tokens[index] && /^(\d+|\d+(?:ms|s|m|h|d))$/.test(tokens[index]!)) index++;
		if (wrapper === "nice" && tokens[index] === "-n") index += 2;
	}
	const invoked = tokens[index];
	if (!invoked) return false;
	const executable = commandBasename(invoked);
	if (executable === "git") return readOnlyGitCommand(tokens.slice(index + 1));
	if (executable === "find" && tokens.slice(index + 1).some(findExecutesCommands)) return false;
	return readOnlyCommands.has(executable);
}

function readOnlyGitCommand(args: readonly string[]): boolean {
	const subcommand = args.find((arg) => !arg.startsWith("-"));
	if (subcommand === undefined || !readOnlyGitCommands.has(subcommand)) return false;
	return subcommand !== "branch" || !args.some((arg) => /^-[dDmMc]$|^--(delete|move|copy|force)$/.test(arg));
}

function shellWords(command: string): string[] | undefined {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;
	for (const character of command) {
		if (escaped) {
			current += character;
			escaped = false;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			else current += character;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}
		if (/\s/.test(character)) {
			if (current) {
				words.push(current);
				current = "";
			}
			continue;
		}
		current += character;
	}
	if (quote || escaped) return undefined;
	if (current) words.push(current);
	return words;
}

function isCircuitBreakerCommand(command: string, depth = 0): boolean {
	// Bound nested eval analysis; excessive nesting cannot disable the fixed safety boundary.
	if (depth > 16) return true;
	const subcommands = splitBashCommand(command);
	if (!subcommands) return false;
	return subcommands.some((subcommand) => {
		const tokens = shellWords(subcommand);
		if (!tokens) return false;
		const runIndex = executableIndex(tokens);
		if (tokens[runIndex] === "eval") {
			return isCircuitBreakerCommand(tokens.slice(runIndex + 1).join(" "), depth + 1);
		}
		const rmIndex = tokens.findLastIndex((token) => commandBasename(token) === "rm");
		if (rmIndex < 0) return false;
		let recursive = false;
		let force = false;
		let optionsEnded = false;
		const targets: string[] = [];
		for (const token of tokens.slice(rmIndex + 1)) {
			if (!optionsEnded && token === "--") {
				optionsEnded = true;
				continue;
			}
			if (!optionsEnded && token.startsWith("-")) {
				const flags = token.replace(/^-+/, "");
				recursive ||= flags.includes("r") || flags.includes("R");
				force ||= flags.includes("f");
				continue;
			}
			targets.push(token);
		}
		return recursive && force && targets.some(isRootOrHomeTarget);
	});
}

function isRootOrHomeTarget(target: string): boolean {
	if (target === "/" || target === "//" || target === "~") return true;
	if (/^(?:\$HOME|\$\{HOME\})(?:\/\.)?$/.test(target)) return true;
	if (target.startsWith("~/")) return resolve(homedir(), target.slice(2)) === resolve(homedir());
	if (target.startsWith("$HOME/") || target.startsWith("$" + "{HOME}/"))
		return resolve(homedir(), target.replace(/^\$\{?HOME\}?\//, "")) === resolve(homedir());
	return resolve(target) === resolve("/") || resolve(target) === resolve(homedir());
}

function canonicalToolName(value: string): CanonicalToolName {
	if (isCanonicalTool(value)) return value;
	throw invalidPermissionCallError(value, "Tool has no registered permission policy");
}

function isCanonicalTool(value: unknown): value is CanonicalToolName {
	return value === "Read" || value === "Write" || value === "Edit" || value === "Bash";
}

function stringArg(args: Readonly<Record<string, unknown>>, key: string): string {
	const value = args[key];
	return typeof value === "string" ? value : "";
}

function resourceText(target: PermissionTarget): string {
	return target.resource.kind === "path"
		? target.resource.path
		: target.resource.kind === "command"
			? target.resource.command
			: target.resource.identity;
}

function decision(
	behavior: PermissionEffect,
	source: PermissionDecision["source"],
	reason: string,
	target: PermissionTarget,
	extra: { readonly rule?: string; readonly risk?: PermissionDecision["risk"] } = {},
): PermissionDecision {
	return {
		behavior,
		source,
		reason,
		rule: extra.rule,
		permission: target.action,
		risk: extra.risk,
	};
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

/** Resolves to the canonical root used to key workspace-scoped grants. */
export function canonicalWorkspaceRoot(value: string): string {
	const absolute = resolve(value);
	try {
		return realpathSync.native(absolute);
	} catch {
		return absolute;
	}
}
