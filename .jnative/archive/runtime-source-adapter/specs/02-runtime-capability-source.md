# 02: 建立 Server Runtime Capability Source

阻塞于:01 · 状态:✅

## 交付什么

Server 在每次 Operation 通过 `RuntimeCapabilitySource` 获取该 Operation 允许使用的 Coding Agent file configuration、Skills、Agent Plugins 与受信任 Extensions 装配结果。Runtime core 不再自行从用户目录读取或按 Desktop/Web 分支；Desktop Local source 与不访问本地文件的测试 source 都能独立验证。

## 动手前(门禁)

先在对话里列出下面三项，列不出来说明 spec 没读够或本身没写清，回去读或补 spec，不要边猜边写：
- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

- Workspace trust 继续由现有 Server SQLite owner 持有；Local source 只读取其 canonical workspace projection，不能从 ACP `cwd` 推断信任。
- Operation capability assembly、Extension/Agent Plugin 实例只在当前 Operation 内存中存活，不可进入 journal、RPC 或 UI projection。
- Provider、API key、Connector OAuth 与 model catalog 仍由 Server SQLite configuration assembly 拥有。

## 硬约束

- 「可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。」（`AGENTS.md`，错误处理规则）
- 「领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。」（`AGENTS.md`，错误处理规则）
- 「每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。」（`AGENTS.md`，模块、入口与依赖方向）
- 「依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract；adapter 依赖 contract 但不携带宿主业务规则；projection 只读取 domain facts；renderer 只能依赖 shared RPC DTO，不得 import Electron 或 Agent 内部实现。」（`AGENTS.md`，模块、入口与依赖方向）
- 「Host（Desktop、CLI）只负责装配、I/O、宿主生命周期与输出适配；不得重实现 Agent、session、权限或 Coding Agent 的产品语义。」（`AGENTS.md`，模块、入口与依赖方向）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，编码规则）

## 风险

- trust 读取失败必须转换为可处理的 Operation open error；`workspace_trust.invalid` 继续保留既有「不信任」处理，而其他 failure 不能被吞掉。
- source 的接口必须表达真实的 Local/Web adapter 差异，却不能变成 SQLite、JSON、目录与插件的泛化 storage 抽象。
- 仅能用测试 source 证明 Server core 不偷读本地文件，不能把它描述为 Web Database adapter。

## 验收(门禁)

未跑完并贴出真实输出，不得标 ✅：
- [x] Operation driver 通过 source 取得本次能力，核心装配路径不再直接发现本地 Agent Plugin 或构造本地文件根。
- [x] Local source 仅在 workspace trust 的 canonical path 存在且受信任时加入 project Agent Plugin roots；trust 失败保留为 Operation open error。
- [x] 不访问本地目录的测试 source 可驱动 Operation，证明 Server core 没有隐式 Local 依赖。
- [x] `cd app/server && bun run typecheck`
- [x] `cd app/server && bun test`

验证输出：

```text
$ bun run typecheck
$ tsc -p tsconfig.json --noEmit

$ bunx --yes bun@1.4.0 test
89 pass, 0 fail, 513 expect() calls
```

当前工作区默认 Bun 1.3.14 无法解析 `node:sqlite`，故等价的完整 Server 测试使用 Bun 1.4.0 运行；该版本支持项目现有 SQLite adapter。

## 决策记录

<!-- 随做随写 -->

- `RuntimeCapabilitySource` 只接受 `sessionId`、`operationId` 和真实 `cwd`，输出本次 Operation 的 `fileCapabilities` 与 Extension 增量。Provider、Connector 与模型装配仍留在 daemon 的既有配置路径，避免 source 变成泛化 storage。
- Operation driver 在 preflight 与 open 统一通过 source 合并能力；source 的 `TaggedError` 被投影为可恢复的 `runtime_operations.open_failed`，而测试 source 能在不触碰目录的情况下驱动 preflight。
- Desktop Local adapter 只用 durable `WorkspaceTrustReader` 的 canonical `workspacePath` 作为 project Agent Plugin roots。`workspace_trust.invalid` 按既有语义降级为未信任；其他 trust 读取失败返回 `runtime_capabilities.resolve_failed`，不吞掉。

## 遗留问题

<!-- 发现但本次不做的 -->

Web database source、tenant 策略与 Skill 内容物化仍未实现；本 spec 只提供其可替换 contract，不能把测试 source 描述为 database adapter。

## 停在哪

<!-- 完成或挂起时填:停在哪、下一刀不许碰什么。写给下一个 session 看,要具体 -->

Runtime capability contract、Local adapter 与 driver 接入已完成。下一刀只可在 daemon composition 使用该 source；不得把 JSON、目录发现或 Workspace trust 读取重新塞回 Runtime core / driver，也不得实现猜测性的 Web storage。
