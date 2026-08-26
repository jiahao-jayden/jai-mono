# 01: Coding Agent 文件化配置根

阻塞于:无 · 状态:⬜

## 交付什么

Coding Agent 能明确接收用户配置根、workspace 配置根和 workspace trust；持久 Session 不再通过语义混杂的 `agentDataRoot` 决定 JSON configuration 与 Skills 在哪里读取。Desktop / Server 可以把真实本地路径传入，SDK 本身不需要知道路径来自哪个 Host。

## 动手前(门禁)

先在对话里列出下面三项,列不出来说明 spec 没读够或本身没写清,回去读或补 spec,不要边猜边写:
- 本次触及的 durable fact 及其 owner
- 本次适用的硬约束(见下)
- 不碰什么(上一个 spec 的「停在哪」+ 本 spec 边界外的)

## 触及的 durable fact

Coding Agent file configuration 与 Skill 目录仍由本地文件系统拥有；不读取、复制或写入 Server SQLite。Session / Operation journal 不变，仍由 `@jai/agent` SQLite journal owner 持有。

## 硬约束

- 「一类 durable fact 只能有一个 owner：会话消息、分支、压缩与 Session App State 属于 `@jai/agent` journal；Todo、Artifact、Extension state 的业务语义属于 `@jai/coding-agent`；标题、项目归属与项目目录属于 Desktop；运行中状态、审批、流式 seq 和 renderer state 都是可丢弃的内存状态。」（`AGENTS.md`，事实归属）
- 「不保留向后兼容。过时的直接删，别加兼容层、别写migration、别留fallback。」（`AGENTS.md`，编码规则）
- 「每个模块只暴露一个小而稳定的 interface；调用方与测试都通过该 interface 使用模块。不要为单一实现建立 interface / factory / strategy。」（`AGENTS.md`，模块、入口与依赖方向）

## 风险

- 旧 `agentDataRoot` 同时承担用户与 workspace 文件根；删除它后必须一次性迁移全部内部 caller，不能留 alias 或 fallback。
- project-local setting 的合并取决于 workspace trust；新输入不能把未信任 workspace 误标为可信。
- Skill runtime 需要同时从 user / workspace roots 读取和按需读取附属文件；只修 `CodingConfigStore` 不算完成。

## 验收(门禁)

未跑完并贴出真实输出,不得标 ✅:
- [ ] public SDK 可以独立指定用户 configuration 根、workspace configuration 根和 workspace trust，且不再暴露 `agentDataRoot`。
- [ ] 单测证明 JSON 合并按指定 user / workspace roots 发生，并按 trust 执行已有 project 规则。
- [ ] 单测证明 Skills 从指定 user / workspace roots 发现，而不是从 Server data directory 推导。
- [ ] `cd packages/coding-agent && bun run typecheck`
- [ ] `cd packages/coding-agent && bun test`
- [ ] `cd packages/coding-agent && bun run test:consumer`

## 决策记录

<!-- 随做随写 -->

## 遗留问题

<!-- 发现但本次不做的 -->

## 停在哪

<!-- 完成或挂起时填:停在哪、下一刀不许碰什么。写给下一个 session 看,要具体 -->
