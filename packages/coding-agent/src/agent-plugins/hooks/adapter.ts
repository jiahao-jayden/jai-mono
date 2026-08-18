import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type {
	AgentPluginComponentAdapter,
	AgentPluginComponentContext,
	AgentPluginComponentResult,
} from "../package/component";
import { isInside } from "../package/paths";
import type { AgentPluginDiagnostic } from "../shared/diagnostics";
import {
	AGENT_PLUGIN_HOOKS_VERSION,
	type AgentPluginCommandHookHandler,
	type AgentPluginHookEntry,
	type AgentPluginHookEvent,
	type AgentPluginHooksDescriptor,
	agentPluginHookEvents,
} from "./types";

const TOP_LEVEL_KEYS = new Set(["version", "description", "hooks"]);
const ENTRY_KEYS = new Set(["matcher", "hooks"]);
const HANDLER_KEYS = new Set(["type", "command", "args", "timeout", "onFailure"]);
const DEFAULT_TIMEOUT_SECONDS = 30;

export const hooksComponentAdapter: AgentPluginComponentAdapter<readonly AgentPluginHooksDescriptor[]> = {
	kind: "hooks",
	load: discoverPluginHooks,
};

async function discoverPluginHooks(
	context: AgentPluginComponentContext,
): Promise<AgentPluginComponentResult<readonly AgentPluginHooksDescriptor[]>> {
	const diagnostics: AgentPluginDiagnostic[] = [];
	const hooksRoot = path.join(context.root, "hooks");
	const canonicalRoot = await realpath(hooksRoot).catch((error) => {
		if (isNodeError(error, "ENOENT")) return undefined;
		diagnostics.push(diagnostic("plugin_hooks_path_invalid", "hooks", "hooks/ cannot be resolved"));
		return undefined;
	});
	if (!canonicalRoot) return { value: [], diagnostics };
	if (!isInside(canonicalRoot, context.root)) {
		diagnostics.push(diagnostic("plugin_hooks_path_escape", "hooks", "hooks/ escapes Plugin root"));
		return { value: [], diagnostics };
	}
	const rootInfo = await stat(canonicalRoot).catch(() => undefined);
	if (!rootInfo?.isDirectory()) {
		diagnostics.push(diagnostic("plugin_hooks_path_invalid", "hooks", "hooks/ must be a directory"));
		return { value: [], diagnostics };
	}

	const location = path.join(canonicalRoot, "hooks.json");
	const canonicalLocation = await realpath(location).catch((error) => {
		if (isNodeError(error, "ENOENT")) return undefined;
		diagnostics.push(diagnostic("plugin_hooks_path_invalid", "hooks", "hooks/hooks.json cannot be resolved"));
		return undefined;
	});
	if (!canonicalLocation) return { value: [], diagnostics };
	if (!isInside(canonicalLocation, canonicalRoot)) {
		diagnostics.push(diagnostic("plugin_hooks_path_escape", "hooks", "hooks/hooks.json escapes hooks/"));
		return { value: [], diagnostics };
	}
	const locationInfo = await stat(canonicalLocation).catch(() => undefined);
	if (!locationInfo?.isFile()) {
		diagnostics.push(diagnostic("plugin_hooks_path_invalid", "hooks", "hooks/hooks.json must be a regular file"));
		return { value: [], diagnostics };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(canonicalLocation, "utf8"));
	} catch {
		diagnostics.push(diagnostic("plugin_hooks_invalid_config", "hooks", "hooks/hooks.json is invalid JSON"));
		return { value: [], diagnostics };
	}
	const document = parseHooksDocument(parsed, diagnostics);
	return { value: document ? [document] : [], diagnostics };
}

function parseHooksDocument(
	value: unknown,
	diagnostics: AgentPluginDiagnostic[],
): AgentPluginHooksDescriptor | undefined {
	if (!isRecord(value) || Object.keys(value).some((key) => !TOP_LEVEL_KEYS.has(key))) {
		diagnostics.push(
			diagnostic("plugin_hooks_invalid_config", "hooks", "hooks/hooks.json top-level object is invalid"),
		);
		return undefined;
	}
	if (value.version !== AGENT_PLUGIN_HOOKS_VERSION || !isRecord(value.hooks)) {
		diagnostics.push(
			diagnostic("plugin_hooks_invalid_config", "hooks", "hooks/hooks.json version or hooks is invalid"),
		);
		return undefined;
	}
	if (value.description !== undefined && typeof value.description !== "string") {
		diagnostics.push(diagnostic("plugin_hooks_invalid_config", "hooks", "hooks/hooks.json description is invalid"));
		return undefined;
	}

	const entries: AgentPluginHookEntry[] = [];
	for (const [eventName, candidate] of Object.entries(value.hooks)) {
		if (!isHookEvent(eventName)) {
			diagnostics.push({
				...diagnostic("plugin_hook_invalid_event", "hook", `Unsupported hook event "${eventName}"`),
				componentName: eventName,
			});
			continue;
		}
		if (!Array.isArray(candidate)) {
			diagnostics.push({
				...diagnostic("plugin_hook_invalid_event", "hook", `Hook event "${eventName}" must be an array`),
				componentName: eventName,
			});
			continue;
		}
		for (const [index, entry] of candidate.entries()) {
			const parsed = parseEntry(eventName, entry, diagnostics, index);
			if (parsed) entries.push(parsed);
		}
	}
	return {
		version: AGENT_PLUGIN_HOOKS_VERSION,
		...(typeof value.description === "string" ? { description: value.description } : {}),
		entries,
	};
}

function parseEntry(
	event: AgentPluginHookEvent,
	value: unknown,
	diagnostics: AgentPluginDiagnostic[],
	index: number,
): AgentPluginHookEntry | undefined {
	if (!isRecord(value) || Object.keys(value).some((key) => !ENTRY_KEYS.has(key)) || !Array.isArray(value.hooks)) {
		diagnostics.push({
			...diagnostic("plugin_hook_invalid_event", "hook", `Hook entry ${index + 1} for "${event}" is invalid`),
			componentName: event,
		});
		return undefined;
	}
	const matcher = parseMatcher(value.matcher);
	if (matcher === undefined && value.matcher !== undefined) {
		diagnostics.push({
			...diagnostic("plugin_hook_invalid_event", "hook", `Hook matcher for "${event}" is invalid`),
			componentName: event,
		});
		return undefined;
	}
	if (matcher && !isToolHookEvent(event)) {
		diagnostics.push({
			...diagnostic(
				"plugin_hook_invalid_event",
				"hook",
				`Hook matcher is only valid for tool events, not "${event}"`,
			),
			componentName: event,
		});
		return undefined;
	}
	const handlers: AgentPluginCommandHookHandler[] = [];
	for (const [handlerIndex, handler] of value.hooks.entries()) {
		const parsed = parseHandler(event, handler);
		if (parsed) {
			handlers.push(parsed);
			continue;
		}
		diagnostics.push({
			...diagnostic(
				"plugin_hook_invalid_handler",
				"hook-handler",
				`Hook handler ${handlerIndex + 1} for "${event}" is invalid`,
			),
			componentName: event,
		});
	}
	if (handlers.length === 0) return undefined;
	return { event, ...(matcher ? { matcher } : {}), handlers };
}

function parseMatcher(value: unknown): readonly string[] | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.length === 0) return undefined;
	const values = value.split("|");
	if (values.some((item) => item.length === 0) || new Set(values).size !== values.length) return undefined;
	return values;
}

function parseHandler(event: AgentPluginHookEvent, value: unknown): AgentPluginCommandHookHandler | undefined {
	if (!isRecord(value) || Object.keys(value).some((key) => !HANDLER_KEYS.has(key))) return undefined;
	if (
		value.type !== "command" ||
		typeof value.command !== "string" ||
		value.command.length === 0 ||
		!isAllowedCommand(value.command)
	)
		return undefined;
	if (!Array.isArray(value.args) || !value.args.every((argument) => typeof argument === "string")) return undefined;
	const timeoutSeconds: unknown = value.timeout === undefined ? DEFAULT_TIMEOUT_SECONDS : value.timeout;
	if (
		typeof timeoutSeconds !== "number" ||
		!Number.isInteger(timeoutSeconds) ||
		timeoutSeconds < 1 ||
		timeoutSeconds > 60
	)
		return undefined;
	const onFailure = value.onFailure === undefined ? "continue" : value.onFailure;
	if (onFailure !== "continue" && onFailure !== "deny") return undefined;
	if (onFailure === "deny" && event !== "PreToolUse") return undefined;
	return {
		type: "command",
		command: value.command,
		args: value.args,
		timeoutSeconds,
		onFailure,
	};
}

function isAllowedCommand(command: string): boolean {
	return command.startsWith("./")
		? !command.includes("\\") && !command.includes("..") && !/[\s|&;<>*?]/.test(command)
		: !command.includes("/") && !command.includes("\\") && !/[\s|&;<>*?]/.test(command);
}

function isHookEvent(value: string): value is AgentPluginHookEvent {
	return (agentPluginHookEvents as readonly string[]).includes(value);
}

function isToolHookEvent(event: AgentPluginHookEvent): boolean {
	return event === "PreToolUse" || event === "PostToolUse" || event === "PostToolUseFailure";
}

function diagnostic(code: string, scope: "hooks" | "hook" | "hook-handler", message: string): AgentPluginDiagnostic {
	return { code, severity: "error", scope, relativePath: "hooks/hooks.json", message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error && error.code === code;
}
