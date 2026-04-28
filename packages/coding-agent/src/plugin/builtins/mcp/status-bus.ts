import { TypedEmitter } from "@jayden/jai-utils";
import type { McpServerInfo } from "./types.js";

/**
 * 进程内 MCP 状态事件总线。Gateway 用它把状态变化推给 desktop UI。
 */
export class McpStatusBus extends TypedEmitter<McpServerInfo> {}
