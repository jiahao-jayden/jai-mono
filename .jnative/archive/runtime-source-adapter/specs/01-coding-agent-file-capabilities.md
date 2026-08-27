# 01: 明确 Coding Agent 的文件能力输入

阻塞于:无 · 状态:✅

## 交付什么

Host 可以在创建一个非 ephemeral Coding Agent 时，分别提供 Coding Agent file configuration 的用户目录、workspace 目录与 workspace trust；SDK 不再把它们混成 `agentDataRoot`。配置与 Skills 都以这些显式输入解析，SDK 的 public API 与内部消费者一次性迁移完成。

## 动手前(门禁)

先在对话里列出下面三项，列不出来说明 spec 没读够或本身没写清，回去读或补 spec，不要边猜边写：
- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

- Coding Agent file configuration 的内容继续由本地文件系统拥有；SDK 只消费 Host 指定的根目录，不持久化、镜像或写回。
- Session 与 Session App State 继续由传入的 `@jai/agent` journal store 持有；本 spec 不改变其 schema、adapter 或生命周期。

## 硬约束

- 「一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；Todo、Artifact、Extension state 的业务语义属于 `@jai/coding-agent`；标题、项目归属与项目目录属于 Desktop；运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。」（`AGENTS.md`，事实归属）
- 「Durable journal 只有 SQLite：CLI 与 Desktop 共用 `$JAI_HOME/data.sqlite`（默认 `~/.jai/data.sqlite`）。不得新增 JSONL、双写、重建索引、fallback 或第二种 durable adapter。」（`AGENTS.md`，事实归属）
- 「依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract；adapter 依赖 contract 但不携带宿主业务规则；projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。」（`AGENTS.md`，模块、入口与依赖方向）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，编码规则）
- 「选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。」（`AGENTS.md`，编码规则）

## 风险

- `agentDataRoot` 同时影响 JSON config 和 Skills；所有 SDK caller 必须在同一刀迁移，并由 public API、Skills 与 consumer tests 覆盖用户根、workspace 根与 trust，避免任一来源静默回到错误目录。
- 不得通过 SDK 输入引入 Desktop、Web、SQLite 或 Server 依赖；它必须保持可由任意 Host 提供的纯 construction input。

## 验收(门禁)

未跑完并贴出真实输出，不得标 ✅：
- [x] Public SDK 已无 `agentDataRoot`，非 ephemeral Agent 以明确文件能力输入解析 user/workspace JSON 与 Skills。
- [x] workspace 未受信任时，项目级 configuration 与 Skills 仍遵循既有 trust 语义。
- [x] `cd packages/coding-agent && bun run typecheck`
- [x] `cd packages/coding-agent && bun test`
- [x] `cd packages/coding-agent && bun run test:consumer`

验证输出：

```text
$ bun run typecheck
$ tsc -p tsconfig.json --noEmit

$ bun test
124 pass, 0 fail, 1144 expect() calls

$ bun run test:consumer
$ node ./scripts/test-consumer.mjs
```

补充：`cd app/server && bun run typecheck` 通过，确认唯一 Server 调用点已迁移。完整 Server `bun test` 在当前 Bun runtime 因不支持 `node:sqlite` 无法加载测试模块；这不是本 spec 的 Coding Agent 验收命令。

## 决策记录

- `fileCapabilities` 是 persistent session 的显式 construction input，包含用户目录、workspace 目录和 trust；ephemeral session 继续使用隔离临时目录。SDK 不再从 `cwd` 或任意数据目录推断这些根。这样保留 public SDK 的 ephemeral 简洁调用，同时让 Host 对持久 Operation 的本地读取有明确授权。
- `prepack` 与 `build` 由 bundler 生成单一、可分发的 declaration entrypoint。此前 bundler 清空 `dist` 后只产出 JS；逐文件 `tsc` 声明又保留了 NodeNext 不可解析的无扩展名内部导入。修复发布工件是这次 public API 变更可验证的一部分。

## 遗留问题

<!-- 发现但本次不做的 -->

## 停在哪

SDK 输入、public package declaration 与文档已完成。下一刀只可在 Server 新建 capability source 并让 Operation driver 消费它；不得恢复 `agentDataRoot`，也不得改变 `fileCapabilities` 的三个字段或 journal owner。
