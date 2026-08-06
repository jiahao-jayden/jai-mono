import { isAbsolute, relative, resolve, sep } from "node:path";
import { normalizePermissionSettings } from "./definition";
import { invalidPermissionCallError } from "./errors";
import { matchesPermissionRule, parsePermissionRule, splitBashCommand } from "./rules";
import type {
	PermissionCall,
	PermissionDecision,
	PermissionEffect,
	PermissionSettings,
	ResolvedPermissionSettings,
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
	"stat",
	"tail",
	"wc",
	"which",
]);
const readOnlyGitCommands = new Set(["branch", "diff", "log", "show", "status"]);
const strippedWrappers = new Set(["builtin", "command", "nice", "noglob", "nohup", "stdbuf", "time", "timeout"]);

export function evaluatePermission(
	call: PermissionCall,
	settings: PermissionSettings | ResolvedPermissionSettings = {},
): PermissionDecision {
	const resolved = normalizePermissionSettings(settings);
	validateCall(call);
	if (call.toolName === "ReportProgress" || call.toolName === "UpdateTodos" || call.toolName === "SpawnAgent") {
		return decision("allow", "built-in", "Internal agent coordination has no direct external side effects");
	}
	if (
		resolved.defaultMode === "plan" &&
		(isEditCall(call) || (call.toolName === "Bash" && !isReadOnlyBash(stringArg(call, "command"))))
	) {
		return decision("deny", "mode", "Plan mode only allows read-only work");
	}
	for (const effect of ["deny", "ask", "allow"] as const) {
		const rule = matchingRule(effect, resolved[effect], call);
		if (rule) return decision(effect, "rule", `Matched ${effect} rule`, rule);
	}

	if (resolved.defaultMode === "dontAsk") {
		return decision("deny", "mode", "Don't Ask denies calls without a matching Allow rule");
	}
	if (resolved.defaultMode === "bypassPermissions") {
		if (resolved.disableBypassPermissionsMode === "disable") {
			return decision("deny", "mode", "Bypass Permissions is disabled by configuration");
		}
		if (call.toolName === "Bash" && isCircuitBreakerCommand(stringArg(call, "command"))) {
			return decision("ask", "built-in", "Destructive root or home removal always requires confirmation");
		}
		return decision("allow", "mode", "Bypass Permissions mode");
	}

	if (isReadCall(call)) {
		return isInsideReadableBoundary(call, resolved.additionalDirectories)
			? decision("allow", "built-in", "Read is inside the workspace boundary")
			: decision("ask", "built-in", "Read is outside the workspace boundary");
	}
	if (isEditCall(call)) {
		if (resolved.defaultMode === "acceptEdits" && isInsideReadableBoundary(call, resolved.additionalDirectories)) {
			return decision("allow", "mode", "Accept Edits allows changes inside the workspace boundary");
		}
		return decision("ask", "built-in", "File modifications require confirmation");
	}
	if (call.toolName === "Bash") {
		const command = stringArg(call, "command");
		if (isCircuitBreakerCommand(command)) {
			return decision("ask", "built-in", "Destructive root or home removal requires confirmation");
		}
		return isReadOnlyBash(command)
			? decision("allow", "built-in", "Built-in read-only Bash command")
			: decision("ask", "built-in", "Bash command requires confirmation");
	}
	if (call.toolName === "Skill") {
		return decision("allow", "built-in", "Skill resources are constrained to the selected Skill root");
	}
	return decision("ask", "built-in", "Unknown permission behavior");
}

function matchingRule(effect: PermissionEffect, rawRules: readonly string[], call: PermissionCall): string | undefined {
	const rules = rawRules.map(parsePermissionRule);
	if (call.toolName !== "Bash") return rules.find((rule) => matchesPermissionRule(rule, call))?.raw;
	const command = stringArg(call, "command");
	const subcommands = splitBashCommand(command);
	if (!subcommands) return undefined;
	if (effect === "allow") {
		const matched = subcommands.every((subcommand) =>
			rules.some((rule) => matchesPermissionRule(rule, withBashCommand(call, subcommand))),
		);
		return matched ? rules.find((rule) => rule.toolName === "Bash")?.raw : undefined;
	}
	return rules.find((rule) =>
		subcommands.some((subcommand) => matchesPermissionRule(rule, withBashCommand(call, subcommand))),
	)?.raw;
}

function withBashCommand(call: PermissionCall, command: string): PermissionCall {
	return { ...call, args: { ...call.args, command } };
}

function validateCall(call: PermissionCall): void {
	if (!isAbsolute(call.workspaceRoot)) {
		throw invalidPermissionCallError(call.toolName, "workspaceRoot must be absolute");
	}
	if (call.toolName === "Bash" && !stringArg(call, "command")) {
		throw invalidPermissionCallError(call.toolName, "Bash permission calls require command");
	}
	if ((isReadCall(call) || isEditCall(call)) && !pathArg(call)) {
		throw invalidPermissionCallError(call.toolName, `${call.toolName} permission calls require path`);
	}
}

function isReadCall(call: PermissionCall): boolean {
	return call.toolName === "Read" || call.toolName === "Glob" || call.toolName === "Grep";
}

function isEditCall(call: PermissionCall): boolean {
	return call.toolName === "Write" || call.toolName === "Edit";
}

function pathArg(call: PermissionCall): string {
	if (call.toolName === "Glob" || call.toolName === "Grep") return stringArg(call, "path") || ".";
	return stringArg(call, "path");
}

function stringArg(call: PermissionCall, key: string): string {
	const value = call.args[key];
	return typeof value === "string" ? value : "";
}

function isInsideReadableBoundary(call: PermissionCall, additionalDirectories: readonly string[]): boolean {
	const input = pathArg(call);
	const target = resolve(call.workspaceRoot, input);
	const roots = [
		resolve(call.workspaceRoot),
		...additionalDirectories.map((directory) =>
			isAbsolute(directory) ? resolve(directory) : resolve(call.workspaceRoot, directory),
		),
	];
	return roots.some((root) => isWithin(root, target));
}

function isWithin(root: string, target: string): boolean {
	const fromRoot = relative(root, target);
	return fromRoot === "" || (!isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`));
}

function isReadOnlyBash(command: string): boolean {
	if (command.includes("$(") || command.includes("`") || /(^|[^<])>(?!>)/.test(command) || />>|<\(|>\(/.test(command))
		return false;
	const subcommands = splitBashCommand(command);
	if (!subcommands) return false;
	return subcommands.every(isReadOnlySubcommand);
}

function isReadOnlySubcommand(command: string): boolean {
	const tokens = shellWords(command);
	if (!tokens || tokens.length === 0) return false;
	let index = 0;
	while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index]!)) index++;
	while (strippedWrappers.has(tokens[index] ?? "")) {
		const wrapper = tokens[index++];
		if (wrapper === "timeout" && tokens[index] && /^(\d+|\d+(?:ms|s|m|h|d))$/.test(tokens[index]!)) index++;
		if (wrapper === "nice" && tokens[index] === "-n") index += 2;
	}
	const executable = tokens[index];
	if (!executable) return false;
	if (executable === "git") return readOnlyGitCommand(tokens.slice(index + 1));
	if (executable === "find" && tokens.slice(index + 1).some((token) => token === "-delete" || token === "-exec")) {
		return false;
	}
	return readOnlyCommands.has(executable);
}

function readOnlyGitCommand(args: readonly string[]): boolean {
	const subcommand = args.find((arg) => !arg.startsWith("-"));
	return subcommand !== undefined && readOnlyGitCommands.has(subcommand);
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

function isCircuitBreakerCommand(command: string): boolean {
	return /(?:^|[;&|]\s*)rm\s+(?:-[A-Za-z]*r[A-Za-z]*f[A-Za-z]*|-[A-Za-z]*f[A-Za-z]*r[A-Za-z]*)\s+(?:\/|~)(?:\s|$)/.test(
		command,
	);
}

function decision(
	behavior: PermissionEffect,
	source: PermissionDecision["source"],
	reason: string,
	rule?: string,
): PermissionDecision {
	return rule === undefined ? { behavior, source, reason } : { behavior, source, reason, rule };
}
