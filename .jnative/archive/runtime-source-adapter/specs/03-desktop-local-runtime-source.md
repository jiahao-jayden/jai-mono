# 03: 接入 Desktop Local source

阻塞于:02 · 状态:✅

## 交付什么

Desktop 使用同一套 Server 时，每个 Operation 都从真实用户目录和当前 workspace 读取 Coding Agent JSON 与 Skills，并从用户目录及受信任 workspace 发现 Agent Plugin。Server 仍只接收真实 `cwd` 与由 Desktop Local source 解析出的能力，不再以 `$JAI_HOME/agent` 冒充用户或 workspace。

## 动手前(门禁)

先在对话里列出下面三项，列不出来说明 spec 没读够或本身没写清，回去读或补 spec，不要边猜边写：
- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

- Coding Agent file configuration、Skill 与 Agent Plugin 文件包的内容继续归本地文件系统拥有；Desktop Local source 不将其镜像、缓存或写回 Server SQLite。
- Provider profile、API key、Connector OAuth、model catalog 与 workspace trust 继续保持现有 Server SQLite owner。
- Session、Operation 与 Session App State 继续只由 `@jai/agent` journal 的 SQLite store 持有。

## 硬约束

- 「一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；Todo、Artifact、Extension state 的业务语义属于 `@jai/coding-agent`；标题、项目归属与项目目录属于 Desktop；运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。」（`AGENTS.md`，事实归属）
- 「Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`（默认 `~/.jai/data.sqlite`）。不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。」（`AGENTS.md`，事实归属）
- 「Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。」（`AGENTS.md`，模块、入口与依赖方向）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，编码规则）

## 风险

- 必须以完整 Operation 覆盖 JSON、Skills 与 Agent Plugin 的本地识别，单元测试不足以发现 daemon 把错误根目录传入 source 的问题。
- `$JAI_HOME/agent` 旧路径不得作为 fallback 继续生效；测试应明确证明它不参与本地文件能力发现。
- Web database source 和租户语义不在范围内；本 spec 只完成 Desktop 的 composition。

## 验收(门禁)

未跑完并贴出真实输出，不得标 ✅：
- [x] Desktop Runtime Host 的 Operation 能读取用户与 workspace 的 JSON/Skills，并采用真实 `cwd`。
- [x] 用户 Agent Plugin 始终可发现；project Agent Plugin 只有在 workspace trust 判定为 trusted 后可发现。
- [x] Provider/API key/OAuth/model catalog/workspace trust 的 SQLite owner 未迁移、未双写。
- [x] `cd packages/coding-agent && bun run typecheck && bun test && bun run test:consumer`
- [x] `cd app/server && bun run typecheck && bun test`

验证输出：

```text
$ cd packages/coding-agent && bun run typecheck && bun test && bun run test:consumer
$ tsc -p tsconfig.json --noEmit
124 pass, 0 fail, 1144 expect() calls
$ node ./scripts/test-consumer.mjs

$ cd app/server && bun run typecheck
$ tsc -p tsconfig.json --noEmit

$ cd app/server && bunx --yes bun@1.4.0 test
89 pass, 0 fail, 513 expect() calls
```

默认 Bun 1.3.14 不支持既有 `node:sqlite` adapter；完整 Server suite 改由 Bun 1.4.0 执行，未改变项目依赖或 lockfile。

## 决策记录

<!-- 随做随写 -->

- `openConfiguredRuntimeHost()` 在 composition root 创建 Desktop Local source，并只把 Provider / Connector assembly 与 source 的结果交给 Operation driver；daemon 不再直接决定本地目录、trust 或 Agent Plugin roots。
- 完整 daemon Operation 建立真实 home、workspace、workspace trust、用户/工作区 Skills 与两类 Agent Plugin。模型请求同时看到四种 Skill，workspace JSON 的 `Bash(mkdir .desktop-source-config)` allow rule 也实际生效，证明配置根来自本次 `cwd`。
- Local source 的 SQLite integration test 以 canonical trust path 验证 project plugin 进入范围；`workspace_trust.invalid` 测试确认无 project capability，corrupted trust 则是可处理 source failure。
- `rg` 审计没有发现 `agentDataRoot` 或 `$JAI_HOME/agent` 残留；Provider、OAuth、model catalog 与 Workspace trust 继续由现有 Server SQLite 模块拥有，未引入双写或新 durable adapter。

## 遗留问题

<!-- 发现但本次不做的 -->

Web database source、tenant 语义与将 Agent Plugin 作为远程内容的产品策略仍不在本 scope。

## 停在哪

<!-- 完成或挂起时填:停在哪、下一刀不许碰什么。写给下一个 session 看,要具体 -->

Desktop Local source 已完成并由 full Operation 验证。后续若实现 Web Host，只能提供另一个 `RuntimeCapabilitySource` adapter；不得修改 Runtime core / driver 来按宿主类型分支，也不得恢复 `$JAI_HOME/agent` fallback。
