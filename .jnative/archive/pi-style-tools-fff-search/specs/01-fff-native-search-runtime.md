# 01: FFF 原生搜索 runtime 与 Pi 工具 contract

阻塞于:无 · 状态:✅

## 交付什么

Agent 在一个 Operation 内可以直接调用 Pi FFF 的 `fffind`、`ffgrep` 搜索工具；工具使用 workspace 边界内的 FFF 原生索引，返回可分页、按文件组织的安全文本结果，并在关闭 Operation 时释放 native runtime。

## 范围

做:

- 钉住 FFF 发布版本、Node/Bun binding、`fffind`/`ffgrep` 的真实参数与返回结构；
- 建立 Operation-scoped FFF runtime，支持索引启动、等待/刷新、取消和销毁；
- 把 FFF 结果转换为 Agent 工具可消费的分组、匹配计数、limit/cursor DTO；
- 把原生/SDK 失败转换成 `filesearch.*` TaggedError/Result 语义；
- 覆盖路径边界、regex/literal、context、cursor、空结果和索引未就绪测试。

不做:

- 不改变默认工具 roster；
- 不从 Server capability source 装配 runtime；
- 不删除现有 `Glob`/`Grep`，这些属于 Spec 02；
- 不修改 Desktop UI 或 Electron Forge 配置。

## 已继承的计划决策

- FFF runtime 是按 Operation 创建和销毁的 Host capability，不是用户可安装 Agent Plugin（见 [plan「方案」](../plan.md#方案)）。
- 搜索动作使用 Pi FFF 的 `fffind`、`ffgrep` 命名与输入形态；`fff-multi-grep` 本轮不暴露（见 [plan「已确认的技术决策」](../plan.md#已确认的技术决策)）。
- 不引入 JAI 的 `workspace-search` 抽象或运行时 fallback。

## 动手前(门禁)

先在对话里列出下面三项,列不出来说明 spec 没读够或本身没写清,回去读或补 spec,不要边猜边写:
- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

无。FFF 索引、cursor 和 runtime 句柄均为 Operation 内存状态；若 adapter 使用本地 frecency/history 文件，不能写入 JAI journal 或 RPC。

## 硬约束

- “领域错误使用 `TaggedError`，`_tag` 采用 `<subsystem>.<reason>`；不要新建裸 `Error` / `TypeError` 作为业务错误。”（`AGENTS.md`）
- “`cause` 仅用于进程内诊断。`TaggedError.toJSON()` 不可跨进程直接使用；RPC、事件和 UI 边界必须通过显式白名单 DTO 投影。”（`AGENTS.md`）
- “依赖方向固定：`core` 不依赖 `runtime`、adapter、host 或 UI；`runtime` 可以依赖 `core` 和自己的 contract；adapter 依赖 contract 但不携带宿主业务规则。”（`AGENTS.md`）
- “每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。”（`AGENTS.md`）
- “不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。”（`AGENTS.md`）

## 风险

- 原生 binding 可能无法在 Bun/Node 或 Electron ABI 中加载；必须先做真实加载/销毁 smoke test。
- 后台索引可能落后于文件编辑；必须固定等待/刷新语义，并让 cursor 只在当前 runtime 内有效。
- FFF fuzzy find 与严格 glob 不等价；本 spec 只实现 Pi FFF contract，不承诺旧 `Glob` 行为。

## 验收(门禁)

未跑完并贴出真实输出,不得标 ✅:
- [ ] 固定一个可安装的 FFF 版本，并在 Node/Bun 运行时完成最小 create → search → destroy smoke test；
- [ ] `fffind` 与 `ffgrep` 的 contract 测试覆盖成功、空结果、limit/cursor、取消、非法 pattern 和 workspace 越界；
- [ ] `cd packages/agent && bun run typecheck`；
- [ ] `cd packages/agent && bun test`；
- [ ] `cd packages/extension && bun run typecheck`；
- [ ] `cd packages/extension && bun test`；
- [ ] 无未筛选 native SDK 错误或内部句柄进入工具结果。

## 决策记录

- 固定使用 `@ff-labs/fff-node@0.10.5`。该 binding 以同步 `Result` 返回 native create/search 结果，索引通过 `waitForIndexReady(15_000)` 在 activation 内等待；失败映射为 `CodingExtensionOperationFailed`，不引入 ripgrep fallback。
- 对 native grep cursor 再包一层 Operation-scoped `fff_cN` opaque cursor。这样 native cursor 句柄不越过工具 DTO，未知/过期 cursor 可稳定投影为 `filesearch.search_failed`，且每个 runtime 最多保留 200 个 continuation。
- 先以 JavaScript `RegExp` 校验含 regex 语法的 pattern。FFF 对非法 regex 会降级为 literal 并附带 `regexFallbackError`；JAI contract 要把非法 pattern 作为 `filesearch.invalid_pattern`，不能静默改变搜索语义。
- `fffind` 使用 FFF fuzzy file search；`ffgrep` 的默认 page size 为 20、上限 50，按 FFF 原始相对路径和 frecency/git 元数据分组输出。未暴露 `fff-multi-grep`。

## 遗留问题

无。

## 停在哪

- 已完成并验证 `@jai/extension/search` 的 `createFffSearchExtension` 和 FFF runtime；`fffind`/`ffgrep` smoke/contract、Extension 全量测试以及 Agent 全量测试全部通过。
- 下一刀进入 Spec 02：仅修改内置 roster、旧 `Glob`/`Grep`/ripgrep 路径、权限和 presentation；不得在本刀装配 Server capability source 或修改 Electron 打包。

## 验收记录

- [x] `@ff-labs/fff-node@0.10.5`：在 Bun 完成 `FileFinder.create → waitForIndexReady → fileSearch/grep → destroy` native smoke test。
- [x] `fffind` / `ffgrep` contract：覆盖成功、空结果、limit/cursor、取消、非法 regex、workspace 越界与关闭 native runtime（`packages/extension/test/search-extension.test.ts`）。
- [x] `cd packages/agent && bun run typecheck`。
- [x] `cd packages/agent && bun test`：242 passed / 0 failed（2026-08-28；同时补回原子 Write/Edit 的 canonical `fileChanges` contract，并将 injected FileSystem test mock 更新为 `writeFileAtomic`）。
- [x] `cd packages/extension && bun run typecheck`。
- [x] `cd packages/extension && bun test`：31 passed / 0 failed。
- [x] 工具结果只含分组文本与 JSON-safe count/cursor DTO；native SDK 错误、handle 与 cause 未进入结果。
