# Jai CLI 与 WorkBuddy 契约

状态：Implementation-ready v1。CLI 已通过 `@jai/coding-agent` public facade 创建和驱动 Agent；本文定义它对交互用户、脚本和 WorkBuddy harness 的共同进程接口。

## 0. 当前范围

### 已实现

- `app/cli` 提供 `jai`、`jai -p <prompt>` 和 stdin prompt；
- 支持 `text`、`json`、`stream-json` 三种输出形态；
- 支持 durable session、临时 session、`--cwd`、`--model`、`--max-turns` 和五种权限模式；
- CLI 只通过 `@jai/coding-agent` 启动 headless Agent，不启动 Electron；
- Coding Agent 的默认系统 prompt 已移动到 `@jai/coding-agent`，Desktop 与 CLI 共享这份基础语义；
- Bash WASM 资源可以在 Node CLI bundle 中解析，CLI 已具备运行基础工具链的条件。

### 当前实现状态与下一步

CLI 进程契约已经可被 WorkBuddy 依赖，Desktop 也已切换到同一 public SDK。实现阶段优先做真实 provider smoke 和 WorkBuddy subprocess 接入；不为 benchmark 增加第二套 Agent 路径。宿主侧只保留 authority、I/O 和投影职责：

| 语义 | 当前所在位置 | 目标归属 |
| --- | --- | --- |
| provider / model / MCP / plugin 装配 | Desktop factory + CLI 各自的 options | `@jai/coding-agent` runtime 的装配接口，由 host 注入 authority |
| `manual` / `automate` / `plan` | Desktop UI、factory、`DesktopAgentHost` | Coding Agent 的 permission/mode contract；Desktop 只做 UI 选择和授权交互 |
| permission request 的展示与决定 | Desktop host 或 CLI broker | runtime 产生稳定 DTO；host adapter 决定如何展示和回答 |
| Todo / Artifact / appState 事实 | Coding runtime 与 Desktop host 的双向读写 | runtime 单一写入；host 只订阅并投影 |
| session 事实与运行控制 | `CodingAgent` 与 Desktop host 混合暴露 | runtime session interface；host 只管理生命周期和传输 |
| session title 生成 | SDK `generateTitle()`；Desktop 负责触发和展示 | host/product service 只提供模型与持久化 authority |

Desktop hard-cut 的具体完成条件和测试矩阵见 [验收与硬切顺序](./verification.md)。

## 1. 运行模型

`jai` 是一个进程级 adapter。它负责终端输入输出、session 选择、权限交互和退出码；Agent 行为由 `@jai/coding-agent` 提供。

```text
jai process
  ├── argv / stdin / TTY
  ├── output renderer
  ├── permission broker
  └── CodingAgent session
        ├── @jai/agent loop
        ├── coding tools
        ├── skills / plugins / MCP
        ├── permissions
        └── FileSessionStore
```

CLI 不直接依赖 Desktop 的 Electron、IPC、SQLite business service 或 UI projection。

这里的关键 seam 是 `@jai/coding-agent` runtime，而不是 `app/cli`。CLI 的实现可以变化输出渲染、TTY 交互和进程退出策略，但不能重新实现 Agent loop、工具装配、prompt、session 事实或权限判定。

## 2. 命令形态

### 2.1 交互模式

```bash
jai
jai "修复登录测试"
```

无 prompt 且 stdin 为 TTY 时进入 REPL。当前实现支持 `/help`、`/exit`、`/quit`；后续增加 `/clear`、`/compact`、`/resume` 和 session picker。

### 2.2 Print 模式

```bash
jai -p "修复登录测试"
cat task.md | jai -p
```

`-p` 只执行一次 prompt，等待 Agent idle 后退出。stdin 只承载 prompt；结构化事件只能写 stdout，交互提示和诊断写 stderr。

### 2.3 选项

| 选项 | 语义 |
| --- | --- |
| `-p, --print [text]` | 单次非交互 prompt |
| `--output-format text\|json\|stream-json` | 输出协议；默认 `text` |
| `--model <profile/model>` | 覆盖 `agent.model` |
| `--cwd <path>` | workspace 根目录；默认当前目录 |
| `--session-id <id>` | 只恢复已存在的 durable session |
| `--no-session-persistence` | 使用临时 session，进程退出时删除 |
| `--permission-mode <mode>` | 覆盖默认权限模式 |
| `--max-turns <n>` | 覆盖单次运行最大 model turn 数 |
| `--trust-workspace` | 允许项目级 trusted 配置参与合并 |
| `-h, --help` | 输出帮助 |
| `-v, --version` | 输出 CLI 版本 |

后续兼容别名：`--continue`、`--resume <id>`、`--fork-session`、`--add-dir <path>`。它们必须映射到同一 session/runtime 实现，不能创建第二套执行路径。

## 3. 配置契约

配置继续复用 `CodingConfigStore`：

```text
~/.jai/settings.json                 user
<cwd>/.jai/settings.json             project-shared
<cwd>/.jai/settings.local.json       project-local
JAI_AGENT_MODEL / JAI_PROVIDERS      environment
CLI flags                            highest priority
```

设置 `JAI_HOME` 可以把 user config 和 durable sessions 重定位到另一个 home root；WorkBuddy 应为每个 trial 使用独立的临时值。

Project 配置只有在 `--trust-workspace` 或宿主明确标记 trusted 时才可扩大权限。WorkBuddy 应通过环境变量或只读配置 mount 注入 provider，不在 task workspace 写入认证信息。

最小 provider 配置示例：

```json
{
  "$schema": "https://jai.dev/schemas/coding-settings-v1.json",
  "schemaVersion": 1,
  "agent": { "model": "bench/openai-model" },
  "providers": {
    "bench": {
      "adapter": "openai-compatible",
      "baseURL": "http://127.0.0.1:8787/v1",
      "auth": "bearer",
      "apiKey": "injected-secret",
      "models": {
        "openai-model": {
          "enabled": true,
          "remoteModelId": "provider-model",
          "input": ["text"],
          "modalities": { "input": ["text"], "output": ["text"] },
          "toolCall": true,
          "contextWindow": 128000,
          "maxTokens": 16384
        }
      }
    }
  }
}
```

## 4. Session

默认 session 持久化到：

```text
~/.jai/sessions/<session-id>.jsonl
```

`--session-id` 是显式恢复入口。未指定时生成 `cli-<uuid>`；非持久化模式使用临时目录并在退出时清理。Desktop 继续使用自己的 session metadata，但对话事实由同一 `FileSessionStore` 语义维护。

未来的 `--continue` 和 `--resume` 只负责选择 session，不改变 Agent runtime；`--fork-session` 通过复制 snapshot 创建新 id。

## 5. 权限

支持以下权限模式：

| 模式 | 语义 |
| --- | --- |
| `default` | 安全操作自动执行，其他操作请求宿主批准 |
| `acceptEdits` | workspace 内编辑自动批准，其他高风险操作仍需批准 |
| `plan` | canonical contract 保留；当前 milestone 不实现，传入时返回 typed unsupported-mode error |
| `dontAsk` | 未匹配 allow rule 的操作自动拒绝 |
| `bypassPermissions` | 跳过权限询问，但仍保留不可绕过的破坏性 circuit breaker |

交互模式通过 TTY 询问；`-p` 无 TTY 时不能等待用户输入。调用方必须显式使用 `--permission-mode dontAsk` 或 `bypassPermissions`，否则遇到未授权操作返回权限错误。

WorkBuddy 只能在它自己的隔离容器中显式使用 `bypassPermissions`。CLI 默认不因检测到 CI、Docker 或 benchmark 环境而自动放宽权限。

## 6. 输出协议

### text

输出最终 assistant 文本；诊断写 stderr。

### json

输出一行最终结果：

```json
{
  "type": "result",
  "sessionId": "cli-...",
  "text": "完成了...",
  "messages": [],
  "usage": {
    "input_tokens": 120,
    "output_tokens": 32,
    "cache_read_input_tokens": 0,
    "cache_creation_input_tokens": 0,
    "reasoning_tokens": 0,
    "total_tokens": 152
  },
  "total_cost_usd": 0.0012
}
```

创建或执行失败时输出同一协议形状的错误对象，不输出 stack/cause：

```json
{
  "type": "error",
  "error": {
    "code": "provider.invalid_model_ref",
    "message": "No default Agent model is configured",
    "phase": "runtime_creation",
    "retryable": false
  }
}
```

### stream-json

每行一个 JSON 对象：

```json
{"type":"system","subtype":"init","session_id":"cli-..."}
{"type":"tool_start","session_id":"cli-...","tool_name":"Bash","tool_call_id":"call-1"}
{"type":"assistant","session_id":"cli-...","message":{"role":"assistant","content":[{"type":"text","text":"完成了..."}],"usage":{"input_tokens":120,"output_tokens":32}}}
{"type":"result","session_id":"cli-...","sessionId":"cli-...","text":"完成了...","usage":{"input_tokens":120,"output_tokens":32,"total_tokens":152},"total_cost_usd":0.0012}
```

`assistant`、`system/init`、`result` 和 tool lifecycle 记录是 CLI 对 SDK canonical event 的 machine-safe projection，字段使用稳定的 snake_case 别名以便被通用 subprocess harness 消费；`result` 同时保留 `sessionId` 供 Jai 客户端使用。事件不能包含 `Error`、stack、cause、provider SDK 原对象或函数。

## 7. 退出码

| code | 含义 |
| ---: | --- |
| `0` | Agent 正常完成 |
| `1` | 配置、provider、runtime 或 Agent 执行失败 |
| `2` | CLI 用法错误或无法处理权限请求 |
| `130` | 用户通过 SIGINT 中止 |

WorkBuddy verifier 通过 workspace 产物决定任务成功；CLI exit code 只表示 Agent 进程是否正常结束。

## 8. WorkBuddy Harness

Harness 只运行固定版本的标准 CLI subprocess：

```bash
cd "$TASK_WORKSPACE"
cat "$TASK_INSTRUCTION_FILE" |
  jai -p \
    --output-format stream-json \
    --permission-mode bypassPermissions \
    --no-session-persistence \
    --max-turns "$MAX_TURNS"
```

Harness 负责固定 CLI 版本、task image、workspace、模型配置和日志/清理。它不得改写题目 prompt、读取 verifier 答案、导入 SDK/Electron，或添加 `--workbuddy-*` 参数。stdout 保存为结构化 trace，stderr 保存为诊断日志，exit code 写入 trial metadata。

CLI 以固定 npm tarball 或等价 split-mount 提供给 task container：`app/cli` 的 `npm pack` 产物包含可执行 bundle 和它声明的 WASM runtime dependencies，安装后只暴露 `jai` binary。harness 不依赖 monorepo 源码路径，也不在 trial 期间联网安装 CLI。

先做一个临时 workspace smoke，随后按 Code、Web、Office、Security 依次验证；四类任务只因 task image 的命令、服务和可选 capability 不同，不拥有第二条 Agent 执行路径。

## 9. 能力矩阵

所有 WorkBuddy 子集都调用同一 CLI，不使用专用模式：

| 能力 | Code | Web | Office | Security |
| --- | :---: | :---: | :---: | :---: |
| Read / Write / Edit / Glob / Grep | ✓ | ✓ | ✓ | ✓ |
| Bash | ✓ | ✓ | ✓ | ✓ |
| Todo / subagent / skills / MCP | ✓ | ✓ | ✓ | ✓ |
| Browser interaction | 可选 | task image 提供 `agent-browser` 时通过 Bash 使用 | 可选 | 可选 |
| 容器提供的 Office / Security 工具 | 可选 | 可选 | 由 task image 提供 | 由 task image 提供 |

CLI 只负责发现和暴露可用 capability；不新增 `--workbuddy-*` 参数，也不把 Office/Security 题目硬编码进 Agent。
