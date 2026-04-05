import type { AgentTool } from "@jayden/jai-agent";

/**
 * 返回 coding-agent 的默认工具集。
 *
 * TODO: 逐步添加工具实现，例如：
 * - read_file
 * - write_file
 * - shell
 * - grep
 * - glob
 */
export function createDefaultTools(_cwd: string): AgentTool[] {
	return [];
}
