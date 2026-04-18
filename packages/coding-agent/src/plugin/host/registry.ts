import type { AgentTool, PreModelRequestContext } from "@jayden/jai-agent";
import type {
  PluginCommandContext,
  PluginMeta,
  PreCompactEvent,
  PreCompactHandler,
  PreCompactResult,
  PreModelRequestHandler,
  PreModelRequestResult,
  PreToolCallHandler,
  RegisteredCommand,
} from "../types.js";

type Bound<T> = { meta: PluginMeta; handler: T };

export type CombineContext = { sessionId: string; workspaceId: string };

export class PluginRegistry {
  private preToolCalls: Bound<PreToolCallHandler>[] = [];
  private preModelRequests: Bound<PreModelRequestHandler>[] = [];
  private preCompacts: Bound<PreCompactHandler>[] = [];
  private commands = new Map<string, RegisteredCommand>();
  private tools: { meta: PluginMeta; tool: AgentTool }[] = [];

  addPreToolCall(meta: PluginMeta, handler: PreToolCallHandler): void {
    this.preToolCalls.push({ meta, handler });
  }

  addPreModelRequest(meta: PluginMeta, handler: PreModelRequestHandler): void {
    this.preModelRequests.push({ meta, handler });
  }

  addPreCompact(meta: PluginMeta, handler: PreCompactHandler): void {
    this.preCompacts.push({ meta, handler });
  }

  addCommand(
    meta: PluginMeta,
    opts: {
      commandName: string;
      description?: string;
      argumentHint?: string;
      handler: (args: string, ctx: PluginCommandContext) => Promise<void> | void;
    },
  ): void {
    const fullName = `${meta.name}:${opts.commandName}`;
    if (this.commands.has(fullName)) {
      throw new Error(`Command "${fullName}" already registered`);
    }
    this.commands.set(fullName, {
      fullName,
      pluginName: meta.name,
      commandName: opts.commandName,
      meta,
      description: opts.description,
      argumentHint: opts.argumentHint,
      handler: opts.handler,
    });
  }

  addTool(meta: PluginMeta, tool: AgentTool, onWarning?: (msg: string) => void): void {
    if (this.tools.find((t) => t.tool.name === tool.name)) {
      onWarning?.(`Tool "${tool.name}" from plugin "${meta.name}" conflicts with existing; skipped`);
      return;
    }
    this.tools.push({ meta, tool });
  }

  listCommands(): RegisteredCommand[] {
    return Array.from(this.commands.values());
  }

  listTools(): AgentTool[] {
    return this.tools.map((t) => t.tool);
  }

  /**
   * Remove all registrations belonging to the named plugin.
   * Used by the loader for transactional rollback when a plugin's factory throws.
   */
  removeByPlugin(pluginName: string): void {
    this.preToolCalls = this.preToolCalls.filter((b) => b.meta.name !== pluginName);
    this.preModelRequests = this.preModelRequests.filter((b) => b.meta.name !== pluginName);
    this.preCompacts = this.preCompacts.filter((b) => b.meta.name !== pluginName);
    this.tools = this.tools.filter((t) => t.meta.name !== pluginName);
    for (const [fullName, cmd] of this.commands) {
      if (cmd.pluginName === pluginName) this.commands.delete(fullName);
    }
  }

  findCommand(fullName: string): RegisteredCommand | undefined {
    return this.commands.get(fullName);
  }

  /**
   * Build combined beforeToolCall-style function for @jayden/jai-agent.
   *
   * The handler list is snapshotted at build time; later `addPreToolCall` calls
   * do not affect the returned function.
   *
   * Iterates handlers in registration order and returns the first non-undefined result.
   */
  buildPreToolCall(combineCtx: CombineContext) {
    const bound = this.preToolCalls.slice();
    return async (ctx: { toolCallId: string; toolName: string; args: unknown }) => {
      for (const { meta, handler } of bound) {
        let result;
        try {
          result = await handler(
            { toolCallId: ctx.toolCallId, toolName: ctx.toolName, input: ctx.args },
            { sessionId: combineCtx.sessionId, workspaceId: combineCtx.workspaceId, meta },
          );
        } catch (err) {
          console.warn(`[plugin:${meta.name}] preToolCall handler threw:`, err);
          continue;
        }
        if (result !== undefined) return result;
      }
      return undefined;
    };
  }

  /**
   * Combined preModelRequest.
   *
   * The handler list is snapshotted at build time; later `addPreModelRequest` calls
   * do not affect the returned function.
   *
   * Each handler's returned fields shallow-merge into the accumulator via `{ ...acc, ...result }`
   * (later handler wins per field). Note: a field set to `undefined` by a later handler
   * still overwrites — if you want "no-op" for a field, omit it from the returned object.
   */
  buildPreModelRequest(combineCtx: CombineContext) {
    const bound = this.preModelRequests.slice();
    return async (ctx: PreModelRequestContext) => {
      let acc: PreModelRequestResult | undefined = undefined;
      for (const { meta, handler } of bound) {
        let result;
        try {
          result = await handler(ctx, {
            sessionId: combineCtx.sessionId,
            workspaceId: combineCtx.workspaceId,
            meta,
          });
        } catch (err) {
          console.warn(`[plugin:${meta.name}] preModelRequest handler threw:`, err);
          continue;
        }
        if (result) acc = { ...(acc ?? {}), ...result };
      }
      return acc;
    };
  }

  /**
   * Combined preCompact.
   *
   * The handler list is snapshotted at build time; later `addPreCompact` calls
   * do not affect the returned function.
   *
   * Short-circuits on the first handler returning `{ skip: true }`.
   */
  buildPreCompact(combineCtx: CombineContext) {
    const bound = this.preCompacts.slice();
    return async (event: PreCompactEvent): Promise<PreCompactResult> => {
      for (const { meta, handler } of bound) {
        let result;
        try {
          result = await handler(event, {
            sessionId: combineCtx.sessionId,
            workspaceId: combineCtx.workspaceId,
            meta,
          });
        } catch (err) {
          console.warn(`[plugin:${meta.name}] preCompact handler threw:`, err);
          continue;
        }
        if (result?.skip) return { skip: true };
      }
      return undefined;
    };
  }
}
