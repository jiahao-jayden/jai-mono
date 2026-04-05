import type { AgentTool } from "@jayden/jai-agent";
import type { ModelInfo } from "@jayden/jai-ai";
import type { Workspace } from "./workspace.js";

/**
 * 完全解析后的 prompt 内容。
 * 由 Workspace.loadPrompts() 产出，传入 buildSystemPrompt()。
 */
export type ResolvedPrompts = {
	static: string;
	soul: string;
	agents: string;
	tools: string;
};

/**
 * AgentSession 的配置。
 * 创建 session 时传入，整个生命周期不可变。
 */
export type SessionConfig = {
	/** workspace 实例 — 由外部创建，注入到 session */
	workspace: Workspace;
	/** 模型信息 — ModelInfo 对象或 "provider/model" 字符串 */
	model: ModelInfo | string;
	/** 自定义 API 地址，透传给 AI SDK */
	baseURL?: string;
	/** 恢复已有 session 时传入 sessionId，否则新建 */
	sessionId?: string;
	/** 注册的工具列表 */
	tools: AgentTool[];
	/** agent loop 最大迭代次数 */
	maxIterations?: number;
};

/**
 * AgentSession 的运行时状态。
 *
 * 状态机: idle → running → idle
 *              ↘ aborted ↗
 *
 * - idle:    等待用户输入
 * - running: agent loop 正在执行
 * - aborted: 用户主动取消
 */
export type SessionState = "idle" | "running" | "aborted";
