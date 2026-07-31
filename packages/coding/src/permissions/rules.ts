import { homedir } from "node:os";
import { isAbsolute, resolve, sep } from "node:path";
import { invalidPermissionRuleError } from "./errors";
import { type CanonicalToolName, canonicalToolNames, type ParsedPermissionRule, type PermissionCall } from "./types";

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
