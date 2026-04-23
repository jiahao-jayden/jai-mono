// packages/coding-agent/src/plugin/types.ts
import type { AgentTool, AgentToolResult, PreModelRequestContext, PreModelRequestResult } from "@jayden/jai-agent";

export type PluginMeta = {
	name: string;
	version: string;
	description?: string;
	rootPath: string;
	scope: "project" | "user";
};

export type PluginContext = {
	readonly sessionId: string;
	readonly workspaceId: string;
	readonly meta: Readonly<PluginMeta>;
};

export type PluginCommandContext = PluginContext & {
	sendUserMessage(text: string): Promise<void>;
};

// ── Event payloads ─────────────────────────────────────
export type PreToolCallEvent = {
	toolCallId: string;
	toolName: string;
	input: unknown;
};

export type PreToolCallResult =
	/** Short-circuit: skip real tool execution and use this result as the tool's output. */
	| { skip: true; result: AgentToolResult; input?: never }
	/** Rewrite tool input before execution. */
	| { skip?: never; result?: never; input: unknown }
	| undefined;

export type PreModelRequestEvent = PreModelRequestContext;
export type { PreModelRequestResult };

export type PreCompactEvent = {
	sessionId: string;
	messageCount: number;
	inputTokens: number;
	contextLimit: number;
};

export type PreCompactResult = { skip: true } | undefined;

// ── Handlers ───────────────────────────────────────────
export type PreToolCallHandler = (
	event: PreToolCallEvent,
	ctx: PluginContext,
) => PreToolCallResult | Promise<PreToolCallResult>;

export type PreModelRequestHandler = (
	event: PreModelRequestEvent,
	ctx: PluginContext,
) => PreModelRequestResult | undefined | Promise<PreModelRequestResult | undefined>;

export type PreCompactHandler = (
	event: PreCompactEvent,
	ctx: PluginContext,
) => PreCompactResult | Promise<PreCompactResult>;

// ── Registered command shape ──────────────────────────
export type RegisteredCommand = {
	/** Namespaced: "pluginName:cmdName" */
	fullName: string;
	pluginName: string;
	commandName: string;
	meta: PluginMeta;
	description?: string;
	argumentHint?: string;
	handler: (args: string, ctx: PluginCommandContext) => Promise<void> | void;
};

// ── The main API handed to plugin authors ─────────────
export interface PluginAPI {
	on(event: "preToolCall", handler: PreToolCallHandler): void;
	on(event: "preModelRequest", handler: PreModelRequestHandler): void;
	on(event: "preCompact", handler: PreCompactHandler): void;

	registerTool(def: AgentTool): void;
	registerCommand(
		name: string,
		opts: {
			description?: string;
			argumentHint?: string;
			handler: (args: string, ctx: PluginCommandContext) => Promise<void> | void;
		},
	): void;

	readonly meta: PluginMeta;
	readonly log: {
		info(msg: string, data?: unknown): void;
		warn(msg: string, data?: unknown): void;
		error(msg: string, data?: unknown): void;
	};
	/**
	 * Environment variables declared by this plugin in `plugin.json`.
	 * Only keys listed under `manifest.env` are exposed here; all other
	 * `process.env` values are hidden. Plugins MUST NOT read `process.env`
	 * directly — use `jai.env.KEY` instead.
	 */
	readonly env: Readonly<Record<string, string | undefined>>;
	/**
	 * Validated user config for this plugin, sourced from
	 * `settings.json → plugins[<name>]`.
	 *
	 * If the plugin's `index.ts` exports a `configSchema` (a Zod schema),
	 * the loader parses the raw value through it and `config` is the parsed
	 * result (typed by `z.infer<typeof configSchema>`). On parse failure the
	 * plugin is not loaded and a LoadError is recorded.
	 *
	 * If no `configSchema` is exported, `config` is the raw JSON value
	 * (or `undefined` when settings don't include an entry for this plugin).
	 */
	readonly config: unknown;
}

/** Plugin factory signature */
export type PluginFactory = (jai: PluginAPI) => void | Promise<void>;
