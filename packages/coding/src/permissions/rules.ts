import { homedir } from "node:os";
import { isAbsolute, resolve, sep } from "node:path";
import { invalidPermissionRuleError } from "./errors";
import {
	type CanonicalToolName,
	canonicalToolNames,
	type ParsedPermissionRule,
	type PermissionCall,
	type PermissionConfig,
	type PermissionEffect,
} from "./types";

export interface PermissionConfigRule {
	readonly permission: string;
	readonly pattern: string;
	readonly action: PermissionEffect;
}

const bashArity: Readonly<Record<string, number>> = {
	"agent-browser": 2,
	aws: 3,
	bun: 2,
	"bun run": 3,
	cargo: 2,
	docker: 2,
	git: 2,
	"git config": 3,
	"git remote": 3,
	"git stash": 3,
	gh: 3,
	go: 2,
	make: 2,
	npm: 2,
	"npm exec": 3,
	"npm run": 3,
	pnpm: 2,
	"pnpm exec": 3,
	"pnpm run": 3,
	yarn: 2,
	"yarn run": 3,
};

const rulePattern = /^([A-Za-z][A-Za-z0-9]*)(?:\(([\s\S]*)\))?$/;

export function parsePermissionRule(rule: string): ParsedPermissionRule {
	const match = rulePattern.exec(rule);
	if (!match) throw invalidPermissionRuleError(rule, `Invalid permission rule: ${rule}`);
	const toolName = match[1];
	if (!isCanonicalToolName(toolName)) {
		throw invalidPermissionRuleError(rule, `Unknown permission tool: ${toolName}`);
	}
	const specifier = match[2];
	if (specifier !== undefined && specifier.length === 0) {
		throw invalidPermissionRuleError(rule, `Permission rule specifier cannot be empty: ${rule}`);
	}
	return specifier === undefined ? { raw: rule, toolName } : { raw: rule, toolName, specifier };
}

export function matchesPermissionRule(rule: ParsedPermissionRule, call: PermissionCall): boolean {
	if (!matchesTool(rule.toolName, call.toolName)) return false;
	if (rule.specifier === undefined || rule.specifier === "*") return true;
	if (rule.toolName === "Bash") return matchBash(rule.specifier, requiredString(call, "command"));
	if (rule.toolName === "Read" || rule.toolName === "Edit") {
		return matchPath(rule.specifier, requiredPath(call), call.workspaceRoot);
	}
	return false;
}

export function flattenPermissionConfig(config: PermissionConfig | undefined): PermissionConfigRule[] {
	if (!config) return [];
	const rules: PermissionConfigRule[] = [];
	for (const [permission, value] of Object.entries(config)) {
		if (typeof value === "string") {
			rules.push({ permission, pattern: "*", action: value });
			continue;
		}
		for (const [pattern, action] of Object.entries(value)) rules.push({ permission, pattern, action });
	}
	return rules;
}

export function permissionName(toolName: CanonicalToolName): string {
	switch (toolName) {
		case "Read":
			return "read";
		case "Write":
		case "Edit":
			return "edit";
		case "Glob":
			return "glob";
		case "Grep":
			return "grep";
		case "Bash":
			return "bash";
		case "Skill":
			return "skill";
		case "SpawnAgent":
			return "task";
		case "UpdateTodos":
			return "todowrite";
	}
}

export function matchesPermissionConfigRule(
	rule: PermissionConfigRule,
	call: PermissionCall,
	command?: string,
): boolean {
	if (!wildcardExpression(rule.permission, false).test(permissionName(call.toolName))) return false;
	const value = command ?? stringArg(call.args, call.toolName === "Bash" ? "command" : "path");
	return call.toolName === "Bash"
		? matchBash(rule.pattern, value)
		: rule.pattern === "*" || wildcardExpression(rule.pattern, true).test(value);
}

export function bashAlwaysPattern(command: string): string | undefined {
	const tokens = shellWords(command);
	if (!tokens || tokens.length === 0) return undefined;
	let best: string | undefined;
	let arity = 0;
	for (const [prefix, count] of Object.entries(bashArity)) {
		const prefixTokens = prefix.split(" ");
		if (prefixTokens.every((token, index) => tokens[index] === token) && prefixTokens.length > arity) {
			best = prefix;
			arity = prefixTokens.length;
			if (count > arity) best = tokens.slice(0, count).join(" ");
		}
	}
	return `${best ?? tokens[0]} *`;
}

export function isDestructiveBashCommand(command: string): boolean {
	if (hasDestructiveRedirection(command) || /\b(?:truncate|dd)\b[^\n]*\bof=/.test(command)) return true;
	const subcommands = splitBashCommand(command);
	if (!subcommands) return true;
	return subcommands.some((subcommand) => {
		const tokens = shellWords(subcommand);
		if (!tokens || tokens.length === 0) return true;
		const executable = tokens.find((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
		if (!executable) return true;
		if (["rm", "rmdir", "unlink", "trash"].includes(executable)) return true;
		if (executable === "find" && tokens.some((token) => token === "-delete" || token === "-exec")) return true;
		if (executable === "git" && tokens.includes("clean")) return true;
		if (executable === "git" && tokens.includes("reset") && tokens.includes("--hard")) return true;
		if (executable === "git" && tokens.includes("checkout") && tokens.includes("--")) return true;
		if (["sh", "bash", "zsh", "node", "python", "python3", "perl", "ruby"].includes(executable)) {
			return tokens.some((token) => token === "-c" || token.includes("$()") || token.includes("`"));
		}
		return false;
	});
}

function hasDestructiveRedirection(command: string): boolean {
	let quote: "'" | '"' | undefined;
	let escaped = false;
	for (let index = 0; index < command.length; index++) {
		const character = command[index]!;
		if (escaped) {
			escaped = false;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}
		if (character === "<" && command[index + 1] === ">") return true;
		if (character !== ">") continue;

		if (command[index + 1] === "&") {
			let destination = index + 2;
			if (command[destination] === "-") {
				index = destination;
				continue;
			}
			const start = destination;
			while (/\d/.test(command[destination] ?? "")) destination++;
			if (destination > start && isShellBoundary(command[destination])) {
				index = destination - 1;
				continue;
			}
			return true;
		}

		let target = index + 1;
		if (command[target] === ">" || command[target] === "|") target++;
		while (/\s/.test(command[target] ?? "")) target++;
		const nullTarget = /^(?:\/dev\/null|"\/dev\/null"|'\/dev\/null')(?=$|[\s;|&)])/.exec(command.slice(target));
		if (nullTarget) {
			index = target + nullTarget[0].length - 1;
			continue;
		}
		return true;
	}
	return false;
}

function isShellBoundary(character: string | undefined): boolean {
	return character === undefined || /[\s;|&)]/.test(character);
}

function stringArg(args: Readonly<Record<string, unknown>>, key: string): string {
	const value = args[key];
	return typeof value === "string" ? value : "";
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

export function splitBashCommand(command: string): string[] | undefined {
	const commands: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;
	for (let index = 0; index < command.length; index++) {
		const character = command[index]!;
		if (escaped) {
			current += character;
			escaped = false;
			continue;
		}
		if (character === "\\" && quote !== "'") {
			current += character;
			escaped = true;
			continue;
		}
		if (quote) {
			current += character;
			if (character === quote) quote = undefined;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			current += character;
			continue;
		}
		if (
			character === "&" &&
			(command[index - 1] === ">" || command[index - 1] === "<" || command[index + 1] === ">")
		) {
			current += character;
			continue;
		}
		const two = command.slice(index, index + 2);
		if (two === "&&" || two === "||" || two === "|&") {
			if (!pushCommand(commands, current)) return undefined;
			current = "";
			index++;
			continue;
		}
		if (character === ";" || character === "|" || character === "&" || character === "\n") {
			if (!pushCommand(commands, current)) return undefined;
			current = "";
			continue;
		}
		current += character;
	}
	if (quote || escaped || !pushCommand(commands, current)) return undefined;
	return commands.length > 0 ? commands : undefined;
}

function matchesTool(ruleTool: CanonicalToolName, callTool: CanonicalToolName): boolean {
	if (ruleTool === callTool) return true;
	if (ruleTool === "Read") return callTool === "Glob" || callTool === "Grep";
	if (ruleTool === "Edit") return callTool === "Write";
	return false;
}

function requiredString(call: PermissionCall, key: string): string {
	const value = call.args[key];
	return typeof value === "string" ? value : "";
}

function requiredPath(call: PermissionCall): string {
	if (call.toolName === "Glob" || call.toolName === "Grep") return requiredString(call, "path") || ".";
	return requiredString(call, "path");
}

function matchBash(pattern: string, command: string): boolean {
	if (pattern.endsWith(" *")) {
		const prefix = pattern.slice(0, -2);
		if (command === prefix) return true;
	}
	return wildcardExpression(pattern, false).test(command);
}

function matchPath(pattern: string, input: string, workspaceRoot: string): boolean {
	if (!input) return false;
	const absoluteInput = normalizePath(isAbsolute(input) ? resolve(input) : resolve(workspaceRoot, input));
	const absolutePattern = normalizePath(resolvePathPattern(pattern, workspaceRoot));
	return wildcardExpression(absolutePattern, true).test(absoluteInput);
}

function resolvePathPattern(pattern: string, workspaceRoot: string): string {
	if (pattern.startsWith("//")) return `/${pattern.slice(2)}`;
	if (pattern === "~") return homedir();
	if (pattern.startsWith("~/")) return `${homedir()}/${pattern.slice(2)}`;
	if (pattern.startsWith("/")) return `${workspaceRoot}/${pattern.slice(1)}`;
	return `${workspaceRoot}/${pattern.replace(/^\.\//, "")}`;
}

function normalizePath(value: string): string {
	return value.split(sep).join("/").replace(/\/+/g, "/");
}

function wildcardExpression(pattern: string, pathMode: boolean): RegExp {
	let source = "^";
	for (let index = 0; index < pattern.length; index++) {
		const character = pattern[index]!;
		if (pathMode && character === "[" && pattern[index + 2] === "]" && "*?[]".includes(pattern[index + 1] ?? "")) {
			source += escapeRegex(pattern[index + 1]!);
			index += 2;
			continue;
		}
		if (character !== "*") {
			source += escapeRegex(character);
			continue;
		}
		if (pathMode && pattern[index + 1] === "*") {
			index++;
			if (pattern[index + 1] === "/") {
				index++;
				source += "(?:.*/)?";
			} else {
				source += ".*";
			}
			continue;
		}
		source += pathMode ? "[^/]*" : ".*";
	}
	return new RegExp(`${source}$`);
}

function escapeRegex(value: string): string {
	return /[\\^$.*+?()[\]{}|]/.test(value) ? `\\${value}` : value;
}

function isCanonicalToolName(value: string): value is CanonicalToolName {
	return (canonicalToolNames as readonly string[]).includes(value);
}

function pushCommand(commands: string[], value: string): boolean {
	const command = value.trim();
	if (!command) return commands.length > 0;
	commands.push(command);
	return true;
}
