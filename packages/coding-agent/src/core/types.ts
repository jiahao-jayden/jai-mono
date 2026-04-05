import type { AgentTool } from "@jayden/jai-agent";
import type { ModelInfo } from "@jayden/jai-ai";

/**
 * AgentSession 的配置。
 * 创建 session 时传入，整个生命周期不可变。
 */
export type SessionConfig = {
	/** 工作目录 — 决定文件操作的根路径、system prompt 里的 cwd */
	cwd: string;
	/** 模型信息 — ModelInfo 对象或 "provider/model" 字符串 */
	model: ModelInfo | string;
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
