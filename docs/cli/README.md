# Jai CLI

Jai CLI 是 Coding Agent 的第一个非桌面宿主。它与 Desktop 共享 `@jai/coding-agent` runtime；WorkBuddy-Bench 只通过 CLI 的公开进程接口消费 Agent。

```text
Desktop ──────┐
              ├── @jai/coding-agent runtime ── @jai/agent
jai CLI ──────┘
    ▲
    │ 普通 CLI 进程接口
WorkBuddy harness
```

## 目标

- `jai` 提供可日常使用的交互式 coding agent。
- `jai -p` 提供无 TTY、可脚本化、可恢复的执行模式。
- 同一套 runtime、工具、提示词、权限判定、MCP、skills、subagent 和 session 语义同时服务 Desktop、CLI 与 WorkBuddy。
- WorkBuddy 的 Code、Web、Office、Security 测试集都通过同一套 CLI 能力运行；CLI 不出现 benchmark 专属参数。

## 设计原则

1. CLI 是产品接口，benchmark 是外部 adapter。
2. Desktop 与 CLI 都只能消费 `@jai/coding-agent` 的运行时接口，不能复制 Agent loop 或工具装配。
3. 进程输出必须 wire-safe、可 JSON round-trip；错误使用稳定的退出码和结构化事件。
4. 默认权限 fail closed；无人值守高权限必须由调用方显式选择。
5. 工作目录是运行时边界，不把 task prompt、benchmark id 或 verifier 规则写入 Agent 产品逻辑。

## 文档

本目录刻意只保留三份实现交接文档：

- 本文：SDK 边界、Host Authority 与 Desktop/CLI 职责。
- [CLI 与 WorkBuddy 契约](./cli-spec.md)：命令、权限、输出与 Harness subprocess 接入。
- [验收与硬切顺序](./verification.md)：实现顺序和共同测试矩阵。

面向 SDK 使用者的可发布文档位于 `app/docs`，由 Blume 构建；根 `docs/cli` 不会作为文档站内容源公开。

## 实现基线

`@jai/coding-agent` 已提供 `createCodingAgent({ host, session, execution })` public facade；`app/cli` 和 Desktop factory 都只通过该接口创建并驱动 Agent。它也是 WorkBuddy subprocess smoke 的唯一入口。

Session 只是创建或恢复对话事实的选项，真正执行 prompt、排队、取消、订阅事件和关闭生命周期的是 `CodingAgent` handle。

```ts
const created = await createCodingAgent({ host, session, execution });
if (created.isErr()) return created.error;

const agent = created.value;
const run = await agent.prompt({ prompt: "修复登录测试" });
await agent.close();
```

`new`、`resume` 和 `ephemeral` 是严格互斥的 session selection：`resume` 找不到 session 必须失败，不能退化成新建；`ephemeral` 在 close 后由 SDK 清理。`plan` 是保留的 permission mode 名称，但当前里程碑返回 `coding_sdk.permission_mode_unsupported`。

Host 只提供外部 authority：模型、workspace、session 存储、人工 approval，以及可选的 capability/connector/diagnostics。SDK 负责 Agent assembly、工具、权限判断、session facts、状态、事件和生命周期。Host 不传 raw agent、tool factory、provider client 或 permission evaluator。

三类消费者的关系应保持如下：

```text
Desktop UI / Electron ──┐
jai CLI ────────────────┼── host adapter ── @jai/coding-agent runtime ── @jai/agent
WorkBuddy harness ─────┘       (各自的 I/O、授权、投影)
```

当前 Desktop 已完成第一阶段 hard-cut：factory 通过 public SDK 创建 `CodingAgent`，Host 直接持有该 handle，SDK 负责 Agent loop、权限判定、session facts、Todo/Artifact 事实和 title 生成。CLI 与 Desktop 已共享同一 public facade。

当前实现阶段只剩宿主侧增强，不再有第二套 Agent 执行语义：

- `DesktopAgentHost` 继续负责 Electron 生命周期、approval UI 的 pending registry、canonical event 到 renderer DTO 的投影；
- Host 的 rebind/关闭协调通过 SDK 的 `waitForIdle`/`abort` 完成；
- Desktop projector 只消费 SDK/business 提供的 host-safe snapshot DTO；
- Artifact/Todo 的事实写入权只在 SDK，Desktop 只做白名单投影。

这些宿主侧增强不改变 CLI 或 WorkBuddy 的 public contract，也不需要引入 Desktop 专属 Agent API。

Desktop 仍拥有 Electron IPC、UI 投影、系统能力和人工授权；CLI 仍拥有 TTY/stdin、输出协议、CLI 权限 broker 和退出码。两者都不能复制 Agent loop、工具装配、prompt 或 session 事实。

## Host 分工

| 层 | 可以拥有 | 不可以拥有 |
| --- | --- | --- |
| `@jai/coding-agent` | Agent assembly、tools、permissions、session facts、state、canonical Agent events、execution drain | Electron/TTY、UI event envelope、benchmark 规则 |
| Desktop | UI、IPC、workspace/library 元数据、approval modal、notifications、UI state | Agent factory、prompt 拼装、tool event 解释、Todo/Artifact/App State 双写 |
| CLI | argv/stdin/TTY、renderer、approval broker、退出码 | Agent loop、tool factory、provider/MCP 内部装配 |
| WorkBuddy | task image、workspace、环境注入、日志、试次清理 | SDK 直连、Electron IPC、benchmark 专属 CLI 参数 |

Desktop 的 UI preset 映射固定为 `manual -> default`、`automate -> bypassPermissions`；`plan` 当前直接显示未实现结果。切换 mode 需要重建 Agent，不能靠 prompt 注入改变运行时语义。

标准 Agent Plugin 根目录的发现同样属于 SDK：CLI 和 Desktop 都调用 `discoverCodingAgentPluginDirectories()`，只将 trusted workspace 的 `.jai/plugins`、`.agents/plugins` 与用户目录中的同名根作为 capability source；SDK 再负责验证和装配。
