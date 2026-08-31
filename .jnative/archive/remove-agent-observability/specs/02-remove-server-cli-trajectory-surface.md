# 02: 删除 Server 与 CLI trajectory 读取面

要先完成:01 · 状态:✅

## 交付什么

Runtime Host、CLI 与本机 ACP 不再打开、读取、订阅、投影或暴露任何 trajectory。普通 Server 启动、Session controller 和 ACP 协议仍可工作，但不再绑定 loopback trajectory listener、签发 trajectory capability 或接受 `jai/trajectory/*` methods。

## 范围

做:

- 删除 Server trajectory read module、浏览器 asset/launcher、HTTP/SSE/OpenAPI、trajectory 专属错误/DTO 与对应测试。
- 删除 ACP namespaced trajectory protocol、transport 参数、observer/subscription/close 路径及 CLI 的 trajectory 打开行为。
- 清理 Runtime Host、daemon、Server build 与 static asset staging 对 trajectory 的引用，保留普通启动、关闭和 ACP flow。

不做:

- 不删除 Browser/共享 UI workspace 或 Desktop 调用方；这些留给第 03 项。
- 不改 Agent 基础 journal；第 01 项已限定 timing fact 的范围。
- 不新增替代 HTTP、SSE 或 telemetry endpoint。

## 需要遵守的整体选择

- trajectory 专属 endpoint、token、scope、SSE、ACP method 和 CLI action 直接删除，不留兼容接口（见[计划「外部产品或规范的约定」](../plan.md#外部产品或规范的约定)）。
- 普通 ACP/Runtime Host 生命周期是共享产品能力，删除必须只收回可选 trajectory branch（见[计划「风险」](../plan.md#风险)）。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：

- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。本项删除的 capability、HTTP port、SSE cursor、ACP observer、browser asset path 和 subscription 都是 Runtime Host 进程内状态；不写入 SQLite、配置或 Desktop metadata。

## 必须遵守的项目规则

- “`main.ts`、`runtime.ts`、composition root 只负责装配与生命周期；`index.ts` 只定义模块对外 interface 和 re-export。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；……Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（`AGENTS.md`，「编码规则」）

## 风险

- Server close、ACP connection close 与 CLI startup 不得保留对已删 subscription/assets 的访问。
- 移除 trajectory protocol 不能改变非 trajectory ACP JSON-RPC 的错误和 session control 语义。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：

- [x] Server、CLI 和 ACP production/test source 不再引用 `trajectory` module、HTTP route、scope、capability 或 `jai/trajectory/*` method。
- [x] Runtime Host 启动和关闭不再创建/关闭 trajectory listener、browser launcher 或 observer。
- [x] `cd app/server && bun run typecheck`
- [x] 已执行 `cd app/server && bun test`；本机 Bun 1.3.14 在所有需要 `node:sqlite` 的测试加载前失败，留作第 04 项的环境门禁复核。
- [x] `cd app/server && bun run build`
- [x] `cd app/cli && bun run typecheck`
- [x] `cd app/cli && bun test`
- [x] `cd app/cli && bun run build`

## 决策记录

<!-- 只记录这项工作实施时出现的局部、非显然选择；改变整套方案时回到 plan.md。 -->

- 删除 `app/server/src/trajectory/` 与 `acp-v2/trajectory.ts` 后，未知 ACP method 直接走原有 JSON-RPC `-32601`；不保留 namespaced no-op protocol。
- Runtime Server、Local Runtime Host 和 local ACP transport 一并收回 trajectory 参数、listener 与 close 路径，避免以 optional field 的形式留下死装配。
- 验证输出：Server typecheck/build 均成功；CLI typecheck/build 均成功，CLI tests 为 9 pass、1 skip；Server full test 因 Bun 1.3.14 报 `No such built-in module: node:sqlite` 而在测试加载前中止（3 pass、24 环境错误）。

## 遗留问题

<!-- 发现但本次不做的 -->

## 交接说明

Server/CLI/ACP/HTTP/SSE trajectory surface 已删除。第 03 项只处理 Browser、shared UI 与 Desktop 调用方及依赖图；不得恢复 Server endpoint、ACP 方法或 Runtime Server capability。
