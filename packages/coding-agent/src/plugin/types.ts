// packages/coding-agent/src/plugin/types.ts
import type {
  AgentTool,
  AgentToolResult,
  PreModelRequestContext,
  PreModelRequestResult,
} from "@jayden/jai-agent";

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
}

/** Plugin factory signature */
export type PluginFactory = (pi: PluginAPI) => void | Promise<void>;
