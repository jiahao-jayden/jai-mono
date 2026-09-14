# 07: 产品装配与端到端安全验收

要先完成:01、02、03、04、05、06 · 状态:✅

## 交付什么

本机开发者可以从 JAI 本机入口安全打开 Browser trajectory，也可以从 Desktop 当前 Session 打开内嵌 trajectory。完整产品在 durable 历史、运行中变化、Browser refresh、renderer reload、Host 重启、错误 Origin、旧/过期 token、scope 提权、ACP observer/controller 隔离、IPC DTO 和资源关闭检查下保持一致、只读、安全、可恢复。

## 范围

做:
- 在 Runtime Host composition root 装配 Server read-only trajectory module、Browser HTTP adapter、JAI namespaced ACP adapter、Browser assets 与 capability issuer；
- Browser 本机 control/CLI 入口复用或启动唯一 Host，为指定 durable Session 签发固定 scope、短期 capability 后调用系统浏览器；
- Desktop 从现有 Session 导航进入内嵌 trajectory，经既定 ACP→Desktop Main→IPC/push 链路，不经过 Browser launch/HTTP/bearer；
- Runtime Host 任一 SQLite、ACP、HTTP、trajectory 或 static assets 启动失败时整体回滚；close 时关闭 SSE 与 ACP observers；
- Desktop Main 管理 `LocalAcpV2Client` 与 Electron IPC/push subscriptions 的独立 close/reload 生命周期；
- 用同一 Session facts 驱动真实 Browser 与 Desktop 端到端矩阵，验证两边 record identity、状态和交互一致；
- 检查 production build 包含 Browser assets、OpenAPI、ACP trajectory protocol 和共享轨迹界面模块，不依赖开发服务器；
- 更新用户可见 help/说明，明确 `/v1` preview、Browser capability、Desktop ACP/IPC、metadata 默认和 live chunk 非 durable。

不做:
- 不把 token、观测地址或 renderer state 写入 `$JAI_HOME`、Desktop catalog、journal、shell profile 或 Browser storage；
- Server 不导入 Electron；Desktop 不 fallback 到 localhost HTTP；Browser 不 fallback 到 ACP/IPC；
- 不把 trajectory 塞进 desktop catalog/config 私有通道；
- 不增加 iframe、远程控制、LAN 分享、账号、团队、多租户、OTLP、聚合或告警；
- 不开放 prompt、cancel、approval、配置或 journal 写 endpoint；
- 不提交 git 或发布 package。

## 需要遵守的整体选择

- 最终依赖链严格遵循 plan：Browser 为 Server module→REST/SSE→Browser data source；Desktop 为 Server module→ACP namespaced adapter→Desktop Main client→IPC/push→Desktop data source（见 [plan「方案」](../plan.md#方案)）。
- composition root 只装配与管理生命周期，不承载 join、projection、auth policy、ACP protocol implementation 或 UI reducer（见 [plan「必须遵守的项目规则」](../plan.md#必须遵守的项目规则)）。
- 验收必须来自 production composition、真实 Browser 和真实 Electron renderer（见 [plan「为什么这样拆分」](../plan.md#为什么这样拆分)）。

## 开始前确认
先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：
- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

本项不新增 durable fact。Session/Operation/timing facts 由 `@jai/agent` journals 维护，Session title/project 由 Desktop catalog 维护。HTTP address、capability、SSE/ACP/IPC subscriptions、Browser/Desktop reducer state 和 host navigation 都是临时状态。

## 必须遵守的项目规则

- “可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。”（`AGENTS.md`，「错误处理规则」）
- “`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影。”（`AGENTS.md`，「错误处理规则」）
- “Durable journal 只有 SQLite……不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。”（`AGENTS.md`，「事实归属」）
- “Projection 是单向读取模型……不得把 projection、UI state、Desktop metadata 写回 journal。”（`AGENTS.md`，「事实归属」）
- “`main.ts`、`runtime.ts`、composition root 只负责装配与生命周期；……它们不得承载领域规则、SQL、UI 投影或协议实现。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。”（`AGENTS.md`，「模块、入口与依赖方向」）
- “修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。”（`AGENTS.md`，「组件规则」）

## 风险

- 多资源 composition 半启动会留下 socket、HTTP port、SSE/ACP observers 或 SQLite lock；必须验证逆序 rollback 和幂等 close。
- Browser 与 Desktop 若使用不同事实时点，表面一致测试没有意义；E2E 必须从同一 Session journal/cursor 驱动两边。
- capability 若出现在 process args、environment、stdout/stderr 或 URL query，会扩大泄露面；本机私有 control response 与 fragment bootstrap 必须经真实进程检查。
- ACP observer 若在最终装配中错误走 controller path，isolated tests 通过也可能影响真实 Agent；production E2E 必须并行运行 controller 和 observer。
- build 若隐含 Vite dev server、Server→Electron import 或 workspace source alias，production artifact 会失败。

## 完成前检查
下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：
- [x] CLI `jai trajectory --session-id` 只为 durable Session 请求固定 scope 的 Browser launch；非法 Session/scope 不会获得 capability；
- [x] Desktop 当前 Session 只进入内嵌 trajectory；其 renderer 没有 localhost HTTP 或 bearer 路径；
- [x] production source scan 证明 Server trajectory 无 Electron import，ACP trajectory 不进入 catalog/config channel；
- [x] Browser 与 Desktop 均消费同一 wire DTO、identity reducer 和 content-not-granted/reconnect 状态；
- [x] durable SQLite recovery、snapshot/live cursor 衔接、SSE/ACP/IPC 断线、cursor expired、Browser refresh、renderer reload 和 Host restart 均由 contract tests 与 production host 验证覆盖；
- [x] controller 已占用时 observer 的 open/reconnect/close 保持旁路，Server/ACP tests 验证 Agent outcome 与时序不变；
- [x] 安全 E2E 覆盖 Bearer 缺失/错误/过期/重启失效、恶意 Origin、CORS wildcard、scope 提权与 wire DTO 脱敏；
- [x] Browser production 检查确认 token 不在 URL query、DOM、storage、network URL 或 console；CLI/HTTP/ACP tests 证明它不进入日志、SQLite、OpenAPI 或 DTO；
- [x] Runtime Host open/rollback/close tests 覆盖 HTTP/SSE/observer 资源释放；Desktop Main 独立管理 IPC subscription close；
- [x] Server、CLI、Desktop production 构建已包含 Browser assets、OpenAPI、ACP adapter 与共享 UI，不依赖 Vite dev server；最终 packaged App 已实际启动 Runtime Host；
- [x] `packages/agent` typecheck 与 231 tests 通过；`packages/coding-agent` typecheck、116 tests 和 `test:consumer` 通过；
- [x] Bun 1.4.0 下 Server typecheck、124 tests 和 build 通过；CLI typecheck、10 pass/1 skip tests 与 build 通过；
- [x] Desktop typecheck、122 tests 和 production package 通过；共享 UI 与 Browser 的 typecheck/test/build/test:browser 均通过；
- [x] Desktop diff-only native button/icon/class scan 通过；真实 Browser 与 Electron renderer 验证完成；
- [x] 本次新增与改动源文件通过 `biome check`。全仓 `bun run lint` 的 138 个历史、未触及格式诊断仍存在，未以无关格式化掩盖；

## 决策记录
- Runtime Host 的 Browser assets 在 Server build 阶段显式 staging；CLI launch、Browser REST/SSE 与 Desktop ACP/IPC 维持三条单向、不可 fallback 的链路。
- 最后一次 macOS package smoke test 使用临时 `$JAI_HOME`：打包 App 成功启动 main、renderer、utility process，并创建 Runtime Host SQLite/lock；随后关闭进程并将所有临时文件移入废纸篓。

## 遗留问题
全仓 Biome 格式基线仍有 138 个未触及文件诊断；这不来自本项且未改变本特性的 target lint 结果。没有为了让总数为零而格式化无关文件。

## 交接说明
七项交付均完成。后续若扩展到跨 Session 聚合、远程访问或 OTLP，必须新建 intent；不得复用 Browser capability、Desktop projection 或本地事实 owner 绕过当前边界。
