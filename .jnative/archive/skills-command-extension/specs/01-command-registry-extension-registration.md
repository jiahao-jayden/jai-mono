# 01: 建立核心 Command registry 与 Extension 注册

阻塞于:无 · 状态:✅

## 交付什么

Coding Agent 能在一次 Operation 内创建一个稳定的 Slash Command registry。TypeScript Extension 可以在激活时注册 Extension command；用户输入 `/name args` 时，核心能找到唯一入口、传递原始 args 与 command context，并完成 handler 或受控 prompt expansion。重复注册不会静默覆盖，未知 slash 仍作为普通输入。

## 范围

做:

- 在 `@jai/coding-agent` 定义小而稳定的 Command 注册、解析、派发和结果 contract，并把注册能力接入 Extension activation context。
- 支持普通 command name、重复 command 的 `/name:1` 等唯一 invocation name，以及后续 `/skill:<name>` 所需的 namespace 解析形状；projection 用 `kind` 加 command subtype 区分 Extension command、File-based command 与 Skill command。
- 将 command handler 的可恢复失败投影为 SDK/Operation 可处理错误；不把 handler 的内部 context 或 cause 暴露给 RPC/renderer。
- 用 fake Extension 与 public SDK/runtime tests 证明直接 handler、prompt-result、重复命令和未知 slash 的行为。

不做:

- 不迁移现有 Skills catalog/runtime，不读取本地 Skill 或 command 文件。
- 不实现 File-based command 或 Skill command 的具体发现逻辑。
- 不接入 Server/Desktop，不向 Agent Plugin 增加 Command 能力。

## 已继承的计划决策

- 遵循 [plan「方案」](../plan.md#方案)：核心拥有 registry/dispatcher，Extension 只注册行为。
- 遵循 [plan「已确认的技术决策」](../plan.md#已确认的技术决策)：handler 接收原始 args 与受控 context；重复命令采用 invocation suffix；Command 与 Skill namespace 分离。

## 动手前(门禁)

先在对话里列出下面三项,列不出来说明 spec 没读够或本身没写清,回去读或补 spec,不要边猜边写:
- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

无新增 durable fact。registry、handler、context 和 invocation resolution 都是当前 Operation 的内存状态；Session journal、Extension state 与消息 projection 的 owner 不变。

## 硬约束

- 「可恢复、调用方可处理的失败使用 `better-result` 的 `Result<T, E>`；跨多个步骤优先使用 `Result.gen` / `Result.await`。」（`AGENTS.md`，错误处理规则）
- 「领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。」（`AGENTS.md`，错误处理规则）
- 「每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。」（`AGENTS.md`，模块、入口与依赖方向）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，编码规则）

## 风险

- handler 的直接工作流与 prompt expansion 必须共享一条 Operation 生命周期，不能各自发明第二套 session 调用入口。
- 重复命令的最终 invocation name 必须在 registry 建立时确定，避免 autocomplete、消息 metadata 和实际 dispatcher 不一致。
- Command 错误不能把 extension context、cause 或 stack 穿过 SDK/Server 边界。

## 验收(门禁)

未跑完并贴出真实输出,不得标 ✅:
- [x] fake Extension 能注册 command；`/name args` 传入未修改的 args，handler 能得到 operation-scoped context，并可通过 `ExtensionCommandContext.sessionState` 更新 Extension state。
- [x] 两个 Extension 注册同名 command 时，registry 暴露确定的 `/name:1`、`/name:2`，没有静默覆盖；未知 slash 保持普通输入。
- [x] Slash invocation 的安全 metadata 能区分 `kind: "command"` 下的 `extension` / `file` subtype 与 `kind: "skill"`，且不携带 handler/context。
- [x] handler 的 `Result`/`TaggedError` 失败能被调用方处理，RPC/事件 projection 不包含 cause、stack 或未筛选对象。
- [x] `cd packages/coding-agent && bun run typecheck`
- [x] `cd packages/coding-agent && bun test`
- [x] `cd packages/coding-agent && bun run test:consumer`

## 决策记录

- Command registry 放在 `packages/coding-agent/src/commands/`，只保存当前 Operation 的注册项与本次 prompt context；不创建 durable store。注册顺序决定同名项的稳定 `/name:1`、`/name:2` invocation。
- `CodingExtensionCommandContext` 由 host adapter 在调用时组装：除 session ID、cwd 和 extension ID 外，复用该 Extension 已受控的 configuration、session state 与 approval 能力；handler 不获得 Agent、journal、RPC 或 renderer 内部对象。
- 普通 Extension command 的 subtype 由 host adapter 强制为 `extension`，而非由 Extension 声明；核心 registry 保留 `file` subtype 给后续内置 Skills Extension 使用，避免任意 Extension 冒充 File-based command。
- command 在旧 Skills slash 解析前派发，故删除未接线的 `commandNames` 优先级入口；Skills runtime 重新只解析 Skill。prompt result 仅通过 `beforeModelCall` 注入 synthetic context，并在 invocation 后清除，不写入 journal。

## 遗留问题

无。Config 与 Skills catalog watcher 以原生目录事件加文件状态轮询兜底后，标准 `bun test` 稳定通过。

## 停在哪

- Command registry、Extension registration、direct handler、prompt result、metadata 与错误投影均已实现。Config 与 Skills catalog watcher 增加文件状态轮询兜底，`bun run typecheck`、`bun test`（128 pass）、`bun run test:consumer` 均通过。下一刀开始 Spec 02；不许在迁移完成前向 Server/Desktop 或 Agent Plugin 开放 Command。
