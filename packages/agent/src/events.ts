import { TypedEmitter } from "@jayden/jai-utils";
import type { AgentEvent } from "./types.js";

/**
 * Agent loop 事件总线。emit `AgentEvent`，订阅方拿到强类型 union。
 *
 * 实现复用 `@jayden/jai-utils.TypedEmitter`；保留 EventBus 类名是为了
 * agent loop / agent-session 既有调用点不动。
 */
export class EventBus extends TypedEmitter<AgentEvent> {}
