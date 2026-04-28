import type { BuiltinPluginDef } from "./types.js";

import { mcpBuiltin } from "./mcp/index.js";
import { skillsBuiltin } from "./skills/index.js";

/**
 * 中央 builtin 插件注册表。
 * agent-session.ts 通过遍历这里来加载所有 builtin。
 *
 * 加新 builtin：
 *  1. 在 builtins/<name>/ 下导出一个 BuiltinPluginDef
 *  2. import 进来并 push 到这个数组
 */
export const BUILTIN_PLUGINS: BuiltinPluginDef[] = [skillsBuiltin, mcpBuiltin];

export type { BuiltinPluginContext, BuiltinPluginDef } from "./types.js";
