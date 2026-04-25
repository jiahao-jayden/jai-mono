// packages/coding-agent/src/plugin/types.ts
import type { AgentTool, AgentToolResult, PreModelRequestContext, PreModelRequestResult } from "@jayden/jai-agent";

export type PluginMeta = {
	name: string;
	version: string;
	description?: string;
	rootPath: string;
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

// ── Boot lifecycle (process-level) ─────────────────────
/**
 * HTTP methods supported by `registerApiRoute`. Restricted to read/write
 * verbs to keep the surface area small; PATCH/DELETE/PUT are intentionally
 * not supported in the first version.
 */
export type PluginRouteMethod = "GET" | "POST";

/**
 * Handler for a plugin-registered API route. Receives the raw `Request` and
 * must return a `Response` (sync or async). Plugins are expected to capture
 * any plugin-local state (paths, config) via closure.
 */
export type PluginRouteHandler = (req: Request) => Response | Promise<Response>;

/**
 * SDK surface available inside `boot(jai)`.
 *
 * `boot` runs once per gateway process at startup, *not* per session.
 * Therefore the boot SDK only exposes capabilities that are meaningful at
 * process scope (HTTP routes, log, env, config). Session-scoped capabilities
 * such as `registerTool` / `registerCommand` / `on(...)` belong to the
 * `default` factory's `PluginAPI`.
 */
export interface PluginBootAPI {
	/**
	 * Register an HTTP route under this plugin's namespace. The gateway
	 * automatically mounts it at `/api/plugins/<plugin-name><path>`.
	 *
	 * - `path` MUST start with `/` (relative to the plugin namespace).
	 * - Only GET / POST are supported.
	 * - Throws synchronously if the same `(method, path)` is registered twice
	 *   inside this plugin's boot.
	 */
	registerApiRoute(method: PluginRouteMethod, path: string, handler: PluginRouteHandler): void;

	readonly meta: PluginMeta;
	readonly log: {
		info(msg: string, data?: unknown): void;
		warn(msg: string, data?: unknown): void;
		error(msg: string, data?: unknown): void;
	};
	/** Same shape as `PluginAPI.env`. */
	readonly env: Readonly<Record<string, string | undefined>>;
	/** Same shape as `PluginAPI.config`. */
	readonly config: unknown;
}

/** Process-level boot factory signature. Optional named export `boot`. */
export type PluginBootFactory = (jai: PluginBootAPI) => void | Promise<void>;
