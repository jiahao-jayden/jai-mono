import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { bashScanFromArgs } from "./bash-parser";
import { normalizePermissionSettings } from "./definition";
import { invalidPermissionCallError } from "./errors";
import {
	bashAlwaysPattern,
	commandBasename,
	findExecutesCommands,
	flattenPermissionConfig,
	isDestructiveBashCommand,
	matchesPermissionConfigRule,
	permissionName,
	splitBashCommand,
} from "./rules";
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
	"rg",
	"sleep",
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
	if (call.toolName === "UpdateTodos" || call.toolName === "SpawnAgent") {
		return decision("allow", "built-in", "Internal agent coordination has no direct external side effects");
	}
	if (call.toolName === "Bash" && isCircuitBreakerCommand(stringArg(call, "command"))) {
		return decision(
			"deny",
			"danger-layer",
			"Deleting the filesystem root or home directory is not allowed",
			undefined,
			{
				permission: "bash",
				risk: "destructive",
			},
		);
	}
	const bashRisk = bashRiskDecision(call);
	if (bashRisk) return bashRisk;
	// Mode boundaries outrank the `permission` tree. A persisted Always Allow must not
	// disable Plan mode or an administrator's `disableBypassPermissionsMode`.
	if (
		resolved.defaultMode === "plan" &&
		(isEditCall(call) || (call.toolName === "Bash" && !isReadOnlyBash(stringArg(call, "command"))))
	) {
		return decision("deny", "mode", "Plan mode only allows read-only work");
	}
	if (resolved.defaultMode === "bypassPermissions" && resolved.disableBypassPermissionsMode === "disable") {
		return decision("deny", "mode", "Bypass Permissions is disabled by configuration");
	}
	if (resolved.permission && Object.keys(resolved.permission).length > 0) {
		return evaluateConfiguredPermission(call, resolved);
	}

	if (resolved.defaultMode === "dontAsk") {
		return decision("deny", "mode", "Don't Ask denies calls without a matching Allow rule");
	}
	if (resolved.defaultMode === "bypassPermissions") {
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
		return evaluateDefaultBash(call);
	}
	return decision("ask", "built-in", "Unknown permission behavior");
}

function evaluateDefaultBash(call: PermissionCall): PermissionDecision {
	const command = stringArg(call, "command");
	const scan = bashScanFromArgs(call.args);
	const subcommands = scan?.patterns ?? splitBashCommand(command);
	if (!subcommands || subcommands.length === 0) {
		return decision("ask", "danger-layer", "Bash command could not be parsed safely", undefined, {
			permission: "bash",
			risk: "opaque",
		});
	}
	const asked = subcommands.filter((subcommand) => !isReadOnlySubcommand(subcommand));
	if (asked.length === 0) {
		return decision("allow", "built-in", "Built-in safe Bash command", undefined, {
			permission: "bash",
			patterns: subcommands,
		});
	}
	return decision("ask", "built-in", `No bash permission rule matched for: ${asked[0]}`, undefined, {
		permission: "bash",
		patterns: asked,
		alwaysPatterns: unique(asked.map((subcommand) => bashAlwaysPattern(subcommand) ?? `${subcommand} *`)),
	});
}

function evaluateConfiguredPermission(call: PermissionCall, settings: ResolvedPermissionSettings): PermissionDecision {
	if (call.toolName === "Bash") {
		const command = stringArg(call, "command");
		const scan = bashScanFromArgs(call.args);
		const subcommands = scan?.patterns ?? splitBashCommand(command);
		if (!subcommands || subcommands.length === 0) {
			return decision("ask", "danger-layer", "Bash command could not be parsed safely", undefined, {
				permission: "bash",
				risk: "opaque",
			});
		}
		const decisions = subcommands.map((subcommand) => configuredBashDecision(call, settings, subcommand));
		const denied = decisions.find((item) => item.behavior === "deny");
		if (denied) return denied;
		const asked = decisions.filter((item) => item.behavior === "ask");
		if (asked.length > 0) {
			const first = asked[0]!;
			return decision("ask", first.source, first.reason, first.rule, {
				permission: "bash",
				patterns: asked.flatMap((item) => item.patterns ?? []),
				alwaysPatterns: unique(asked.flatMap((item) => item.alwaysPatterns ?? [])),
			});
		}
		return decision("allow", "rule", "All Bash command nodes are allowed", undefined, {
			permission: "bash",
			patterns: subcommands,
		});
	}
	return configuredRuleDecision(call, settings);
}

function configuredBashDecision(
	call: PermissionCall,
	settings: ResolvedPermissionSettings,
	command: string,
): PermissionDecision {
	const matched = flattenPermissionConfig(settings.permission).findLast((rule) =>
		matchesPermissionConfigRule(rule, call, command),
	);
	if (matched) return configuredRuleDecision(call, settings, command);
	if (isReadOnlySubcommand(command)) {
		return decision("allow", "built-in", "Built-in safe Bash command", undefined, {
			permission: "bash",
			patterns: [command],
		});
	}
	return decision("ask", "built-in", `No bash permission rule matched for: ${command}`, undefined, {
		permission: "bash",
		patterns: [command],
		alwaysPatterns: [bashAlwaysPattern(command) ?? `${command} *`],
	});
}

function bashRiskDecision(call: PermissionCall): PermissionDecision | undefined {
	if (call.toolName !== "Bash") return undefined;
	const command = stringArg(call, "command");
	const scan = bashScanFromArgs(call.args);
	if (scan?.destructive || isDestructiveBashCommand(command)) {
		return decision("ask", "danger-layer", "Destructive Bash operation requires approval", undefined, {
			permission: "bash",
			risk: "destructive",
		});
	}
	if (scan?.opaque) {
		return decision("ask", "danger-layer", "Bash command could not be parsed safely", undefined, {
			permission: "bash",
			risk: "opaque",
		});
	}
}

function configuredRuleDecision(
	call: PermissionCall,
	settings: ResolvedPermissionSettings,
	command?: string,
): PermissionDecision {
	const permission = permissionName(call.toolName);
	const matched = flattenPermissionConfig(settings.permission).findLast((rule) =>
		matchesPermissionConfigRule(rule, call, command),
	);
	if (!matched)
		return decision("ask", "built-in", `No ${permission} permission rule matched`, undefined, { permission });
	return decision(
		matched.action,
		"rule",
		`Matched ${matched.action} permission rule`,
		`${permission}:${matched.pattern}`,
		{
			permission,
			patterns: command ? [command] : undefined,
			alwaysPatterns: command ? [bashAlwaysPattern(command) ?? `${command} *`] : undefined,
		},
	);
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
	return call.toolName === "Read";
}

function isEditCall(call: PermissionCall): boolean {
	return call.toolName === "Write" || call.toolName === "Edit";
}

function pathArg(call: PermissionCall): string {
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
	const invoked = tokens[index];
	if (!invoked) return false;
	// Basename so `/usr/bin/git` classifies like `git` instead of falling through as unknown.
	const executable = commandBasename(invoked);
	if (executable === "git") return readOnlyGitCommand(tokens.slice(index + 1));
	if (executable === "find" && tokens.slice(index + 1).some(findExecutesCommands)) {
		return false;
	}
	return readOnlyCommands.has(executable);
}

function readOnlyGitCommand(args: readonly string[]): boolean {
	const subcommand = args.find((arg) => !arg.startsWith("-"));
	if (subcommand === undefined || !readOnlyGitCommands.has(subcommand)) return false;
	// `git branch` only reads while it lists; -d/-D/-m/-M mutate refs.
	if (subcommand === "branch") return !args.some((arg) => /^-[dDmMc]$|^--(delete|move|copy|force)$/.test(arg));
	return true;
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
	const subcommands = splitBashCommand(command);
	if (!subcommands) return false;
	return subcommands.some((subcommand) => {
		const tokens = shellWords(subcommand);
		if (!tokens) return false;
		// Matched by basename so `/bin/rm -rf /` trips the breaker like a bare `rm` does.
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

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function decision(
	behavior: PermissionEffect,
	source: PermissionDecision["source"],
	reason: string,
	rule?: string,
	extra?: Pick<PermissionDecision, "permission" | "patterns" | "alwaysPatterns" | "risk">,
): PermissionDecision {
	return {
		behavior,
		source,
		reason,
		...(rule === undefined ? {} : { rule }),
		...extra,
	};
}
