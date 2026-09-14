# 03: 删除 Browser、共享 UI 与 Desktop 消费方

要先完成:02 · 状态:✅

## 交付什么

Browser、Desktop 和 workspace graph 不再包含 trajectory 产品。Desktop 聊天页面恢复为不提供 trajectory 打开入口的常规会话体验；Browser/shared trajectory packages 不再存在；Electron ACP/IPC 不再传递 trajectory snapshot 或 update。

## 范围

做:

- 删除 `@jai/trajectory-ui` 与 `@jai/trajectory-browser` 的所有源文件、测试、package manifest 和 build configuration。
- 删除 Desktop trajectory page、data source、ACP host bridge、RPC schema/router、preload/push event、route、chat entry 和相关测试。
- 从 Desktop/Server manifests、workspace lockfile 及构建配置移除仅由该能力引入的依赖和 staging。

不做:

- 不重做聊天、Session navigation、基础 Desktop IPC 或普通 ACP host。
- 不删除 Server 的基础产品代码；trajectory Server surface 已由第 02 项删除。
- 不删除调研文档、历史 JN 工件或无关 workspace dependency。

## 需要遵守的整体选择

- 共享 UI 和 Browser workspace 都是 feature-only code，应完整删除而非留空 package（见[计划「方案」](../plan.md#方案)）。
- Desktop 只移除 trajectory 专属 route/bridge/entry，聊天与其它 UI 保持原行为（见[计划「需要先想清的事」](../plan.md#需要先想清的事)）。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：

- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。被删的 trajectory reducer、selected record、cursor、SSE/IPC subscription 与 route 都是可丢弃客户端/进程状态；Session 标题、项目归属和 journal 事实的 owner 均不改变。

## 必须遵守的项目规则

- “`app/desktop` 的产品界面优先复用 `src/components/ui/*`；已有等价组件时，不直接书写原生交互元素或重复实现 hover、focus、loading、disabled 等状态。”（`AGENTS.md`，「组件规则」）
- “修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。”（`AGENTS.md`，「组件规则」）
- “renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（`AGENTS.md`，「编码规则」）

## 风险

- Desktop 的 shared RPC DTO、preload、main host 与 renderer route 必须一起收回，不能留下只在一端存在的 protocol 类型。
- 删除 lockfile 时要保留其他 transitive consumer 仍需的包；仅移除 feature workspace/direct dependency。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：

- [x] 不再存在 trajectory Browser/shared UI workspace、Desktop trajectory source/route/IPC event 或 package dependency。
- [x] `bun.lock` 不再声明 `@jai/trajectory-ui`、`@jai/trajectory-browser` 或只由其引入的 direct dependency。
- [x] `cd app/desktop && bun run typecheck`
- [x] `cd app/desktop && bun test`
- [x] `cd app/desktop && bun run build`

## 决策记录

<!-- 只记录这项工作实施时出现的局部、非显然选择；改变整套方案时回到 plan.md。 -->

- `DesktopAcpAgentHost` 的 trajectory subscription、pending items 和跨 projection 的 sequence map 一并移除；聊天的每个运行期 projection 恢复为自身的 `seq`，不留下只为 trajectory push 服务的进程状态。
- `bun install --lockfile-only` 用于按剩余 workspace graph 重建 lockfile；搜索确认 `app/desktop`、`app/trajectory-browser`、`packages`、`bun.lock` 均无 trajectory 引用。
- 验证输出：Desktop typecheck 成功；Desktop tests 为 122 pass；Desktop Electron package build 成功。

## 遗留问题

<!-- 发现但本次不做的 -->

## 交接说明

Browser、shared UI、Desktop trajectory UI/IPC 与 workspace graph 已删除。第 04 项只做全仓库残留审计、清理生成物与回归检查；不应再修改产品行为或重新引入删除的 package。
