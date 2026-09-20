# Pi Agent 权限系统调研

核验日期：2026-09-19。源码基线固定为 `earendil-works/pi@36b60d2e8985899743c4cf5bd5f8929832a3f05d`（`main` 在 2026-09-18T22:24:10Z 指向该 commit）。用户给出的 canonical 候选 `badlogic/pi-mono` 当前重定向到 `earendil-works/pi`；README 将其定义为 Pi Agent Harness，包含 `pi-coding-agent` 与 `pi-agent-core`。固定 SHA 是为了避免后续权限实现或文档变更混入结论。

## 结论

1. **Pi 没有内置的文件、进程、网络、凭据隔离，也没有内置 permission popup。** 默认能力主体就是启动 Pi 的用户和进程；`read`、`write`、`edit`、`bash` 以及扩展代码直接继承宿主权限。限制：这是官方明确的设计边界，不代表 Pi 自身提供了“默认安全”的策略。[证据：默认主体](#1-默认主体是启动-pi-的用户进程)
2. **内置的 trust 机制只保护“是否加载项目提供的设置/扩展/技能/包”，不保护之后的工具执行。** 它是输入加载 gate，不是 sandbox；信任后模型仍能通过工具访问进程可访问的资源。[证据：Project Trust](#4-project-trust-的主体是项目资源加载)
3. **工具策略是 tool-name 级 allowlist/denylist，而不是 path/command capability policy。** `--tools`、`--exclude-tools`、`--no-tools` 同时覆盖 built-in、extension、custom tool；默认 active tools 是 `read,bash,edit,write`，其余 built-in 可注册但默认不 active。[证据：工具面](#7-默认工具面和-name-allowlist)
4. **审批触发条件不是 built-in 风险分类，而是扩展自定义的 `tool_call` handler。** handler 可读取已校验参数、弹出 UI、阻断调用、返回原因，并可要求当前 tool batch 终止；Pi 不会自动为 `rm`、`sudo`、写敏感路径或网络请求弹窗。[证据：执行前 gate](#8-通用审批由-tool_call-扩展-gate-实现)
5. **一次性/持久授权只存在于 project trust，不存在于通用 tool approval。** trust 可选择当前 session、当前目录、父目录并写入 `~/.pi/agent/trust.json`；tool gate 示例每次调用自行决定，仓库没有通用的“允许本次/允许本 session/永久允许”状态机。[证据：trust 持久化](#5-trust-的默认值范围和持久化是明确的)
6. **路径和命令约束必须由外部 sandbox 或扩展实现。** 内置文件工具只做 cwd 相对路径解析；bash 直接 spawn 当前 shell。官方示例的 OS sandbox 扩展才提供 `allowedDomains`、`denyRead`、`allowWrite`、`denyWrite` 等约束。[证据：sandbox 扩展](#11-可选-sandbox-扩展才提供-networkfilesystem-policy)
7. **非交互模式 fail closed 的范围很窄：project trust 没有 UI 时默认不加载受保护项目资源；通用 tool approval 若未由扩展实现，则不存在自动阻断。** `-p`、JSON、RPC 不显示 trust prompt，但仍可用 `--approve`/`--no-approve` 覆盖本次 trust。[证据：非交互 trust](#13-非交互-trust-是无-ui-的-fail-closed-但工具审批没有默认等价物)
8. **工具阻断会变成模型可见的 error tool result，而不是抛出进程级拒绝。** `terminate: true` 只有在当前 batch 的所有 finalized tool result 都满足终止条件时才会提前结束。限制：如果扩展只返回 `block`，agent 可能继续下一轮；策略作者必须明确终止语义。[证据：阻断与取消](#14-阻断取消会进入-tool-result-和-abort-signal-语义)
9. **恢复时，session transcript 可以恢复 active tool loadout，但不会恢复通用审批决定或 sandbox 运行时。** tool 名称从当前 system message 的 `toolsAdded` 恢复，并再次经过当前 allow/deny 过滤；trust 读取独立的 `trust.json`，sandbox 扩展在 `session_start` 重新初始化。[证据：session 恢复](#16-session-恢复的是-tool-loadout-不是审批状态)
10. **跨进程边界由 RPC 协议负责传输 UI 请求和 abort，不负责提供安全边界。** RPC host 可以实现 `select`/`confirm`/`input`，但是否真正展示、是否持久化审批、是否把工具路由到隔离环境，都由 host/extension 决定。[证据：RPC](#17-rpc-是可编排的-ui取消边界不是权限边界)
11. **网络/外部工具能力默认是“宿主进程可用”。** Pi 没有内置 MCP，也没有通用 network policy；扩展是 TypeScript 模块并以同一进程权限运行。想限制网络、凭据或外部工具，官方建议把 whole Pi 或 tool execution 放进 Docker、Gondolin、OpenShell、Docker Sandboxes 等边界。[证据：外部隔离](#跨进程边界与外部隔离)
12. **测试覆盖了 trust 持久化、allowlist 过滤、tool_call 阻断、bash 超时/abort/进程树处理和 sandbox 示例的运行接线，但没有证明通用权限模型，因为该模型并不存在。** 这组测试更像“扩展点和失败语义的 contract tests”，不是内置 capability enforcement 的证明。[证据：测试证据](#测试证据)

每条结论的限制：以上结论只描述固定 commit 的 `pi-coding-agent` / `pi-agent-core` 以及该 commit 附带文档和示例；第三方容器运行时的强制能力不等同于 Pi 自身能力。

## 权限主体与能力

### 1. 默认主体是启动 Pi 的用户/进程

README 直接声明 Pi 不提供内置权限系统；文件、进程、网络、凭据访问默认沿用启动它的用户和进程。限制：这里的“默认”包含用户自行安装的扩展；扩展不是受限插件。

[`README.md#L40-L48`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/README.md#L40-L48)

> ## Permissions & Containerization
> 
> Pi does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.
> 
> If you need stronger boundaries, containerize or sandbox Pi. See [packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) for three patterns:
> 
> - **Gondolin extension**: keep `pi` and provider auth on the host while routing built-in tools and `!` commands into a local Linux micro-VM.
> - **Plain Docker**: run the whole `pi` process in a local container for simple isolation.
> - **OpenShell**: run the whole `pi` process in a policy-controlled sandbox.

### 2. 内置文件和 shell 工具直接使用宿主能力

内置 `bash` 通过当前 shell 配置 `spawn` 子进程，cwd 和环境由 Pi 传入；没有 path allowlist、命令解析器或网络判定。限制：它支持可插拔 `BashOperations`，因此宿主可以替换执行后端，但这不是默认隔离。

[`packages/coding-agent/src/core/tools/bash.ts#L55-L78`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/tools/bash.ts#L55-L78)

```ts
/**
 * Pluggable operations for the bash tool.
 * Override these to delegate command execution to remote systems (for example SSH).
 */
export interface BashOperations {
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    },
  ) => Promise<{ exitCode: number | null }>;
}
```

[`packages/coding-agent/src/core/tools/bash.ts#L80-L102`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/tools/bash.ts#L80-L102)

```ts
export function createLocalShellOperations(shellName: string, resolveShellConfig: () => ShellConfig): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      const timeoutMs = resolveTimeoutMs(timeout);
      if (signal?.aborted) throw new Error("aborted");
      const shellConfig = resolveShellConfig();
      await fsAccess(cwd, constants.F_OK);
      const child = spawn(shellConfig.shell, commandArgs, {
        cwd,
        detached: process.platform !== "win32",
        env: env ?? getShellEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });
```

### 3. 文件工具只做路径解析，不形成安全边界

`write` 把相对路径解析到 cwd 后直接创建父目录并写文件；`edit` 对同样解析出的绝对路径直接读写。限制：`~` 展开和绝对路径支持意味着调用方可以明确请求 cwd 外路径；源码没有拒绝 `..`、`.env`、`.git` 或 home 路径的通用逻辑。

[`packages/coding-agent/src/core/tools/write.ts#L44-L89`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/tools/write.ts#L44-L89)

```ts
export function createWriteToolDefinition(
  cwd: string,
  options?: WriteToolOptions,
): ToolDefinition<typeof writeSchema, undefined> {
  const ops = options?.operations ?? defaultWriteOperations;
  return {
    name: "write",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does.",
    async execute(_toolCallId, { path, content }, signal, _onUpdate, ctx) {
      const absolutePath = resolveToCwd(path, ctx?.cwd || cwd);
      const dir = dirname(absolutePath);
      return withFileMutationQueue(absolutePath, async () => {
        await ops.mkdir(dir);
        await ops.writeFile(absolutePath, content);
```

## 默认策略、审批与持久授权

### 4. Project trust 的主体是项目资源加载

安全文档明确把 project trust 定义为设置、资源、包和扩展的加载控制，并明确说它不是 sandbox。限制：被拒绝的是项目提供的输入/代码加载；全局扩展、CLI `-e` 扩展和上下文文件有单独的加载规则。

[`packages/coding-agent/docs/security.md#L5-L27`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/security.md#L5-L27)

> ## Project Trust
> 
> Project trust controls whether pi loads project-local settings, resources, packages, and extensions. It is not a sandbox and it does not restrict what the model can ask tools to do after you start working in a directory.
> 
> Pi considers a project to have resources that require trust when it finds any of these from the current working directory:
> 
> - `.pi/settings.json`
> - `.pi/extensions`, `.pi/skills`, `.pi/prompts`, or `.pi/themes`
> - `.pi/SYSTEM.md` or `.pi/APPEND_SYSTEM.md`
> - project `.agents/skills` in the current directory or an ancestor directory
> 
> Trusting a project allows pi to load project resources that require trust, including:
> 
> - `.pi/settings.json`
> - `.pi` resources such as extensions, skills, prompt templates, themes, and system prompt files

### 5. trust 的默认值、范围和持久化是明确的

默认 `defaultProjectTrust` 是 `ask`；交互模式可保存当前目录或父目录决定，保存文件是 `~/.pi/agent/trust.json`，按 canonical path 查找最近的父级决定。限制：这是路径级布尔决定，不带用户、仓库版本、资源 hash 或审批理由。

[`packages/coding-agent/docs/settings.md#L12-L22`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/settings.md#L12-L22)

> ### Project Trust
> 
> On interactive startup, pi asks before trusting a project folder that contains project-local settings, resources, or project `.agents/skills` and has no saved decision for the folder or a parent folder in `~/.pi/agent/trust.json`.
> 
> Trusting a project allows pi to load `.pi/settings.json` and `.pi` resources, install missing project packages, and execute project extensions.
> 
> Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a trust prompt.
> 
> Use `/trust` in interactive mode to save a project trust decision for future sessions, including trust for the immediate parent folder.
> It writes `~/.pi/agent/trust.json` only; the current session is not reloaded, so restart pi for changes to take effect.

### 6. 解析 trust 时，扩展可以先接管决定

`resolveProjectTrusted` 的顺序是：显式 override → 无需 trust 的项目直接通过 → 已加载的全局/CLI 扩展的 `project_trust` 结果 → 持久 trust store → `always/never/ask` → 无 UI 时拒绝 → UI 选择并按选项持久化。限制：扩展本身必须先来自受信任来源；该逻辑只决定是否加载项目资源。

[`packages/coding-agent/src/core/project-trust.ts#L46-L95`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/project-trust.ts#L46-L95)

```ts
export async function resolveProjectTrusted(options: ResolveProjectTrustedOptions): Promise<boolean> {
  if (options.trustOverride !== undefined) return options.trustOverride;
  if (!hasTrustRequiringProjectResources(options.cwd)) return true;
  if (options.extensionsResult) {
    const { result } = await emitProjectTrustEvent(...);
    if (result) {
      const trusted = result.trusted === "yes";
      if (result.remember === true) options.trustStore.set(options.cwd, trusted);
      return trusted;
    }
  }
  const decision = options.trustStore.get(options.cwd);
  if (decision !== null) return decision;
  switch (options.defaultProjectTrust ?? "ask") {
    case "always": return true;
    case "never": return false;
```

`ProjectTrustStore` 将路径 canonicalize 后写入 JSON，并从当前目录向父目录查找最近决定；写入使用 lockfile。限制：trust store 损坏会抛错，源码没有将坏文件安全降级为 deny。

[`packages/coding-agent/src/core/trust-manager.ts#L44-L57`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/trust-manager.ts#L44-L57)

```ts
function findNearestTrustEntry(data: TrustFile, cwd: string): ProjectTrustStoreEntry | null {
  let currentDir = normalizeCwd(cwd);
  while (true) {
    const value = data[currentDir];
    if (value === true || value === false) return { path: currentDir, decision: value };
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}
```

## 工具策略与审批触发

### 7. 默认工具面和 name allowlist

CLI 公开的工具策略是 allowlist、denylist 和全禁用；内置 tool names 是 `read,bash,powershell,edit,write,grep,find,ls`。限制：名称策略只控制“哪些 tool 可暴露/调用”，不约束 tool 内部的路径、命令参数、网络域名或凭据。

[`packages/coding-agent/docs/usage.md#L208-L217`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/usage.md#L208-L217)

> ### Tool Options
> 
> | Option | Description |
> |--------|-------------|
> | `--tools <list>`, `-t <list>` | Allowlist specific built-in, extension, and custom tools |
> | `--exclude-tools <list>`, `-xt <list>` | Disable specific built-in, extension, and custom tools |
> | `--no-builtin-tools`, `-nbt` | Disable built-in tools but keep extension/custom tools enabled |
> | `--no-tools`, `-nt` | Disable all tools |
> 
> Built-in tools: `read`, `bash`, `powershell` (Windows), `edit`, `write`, `grep`, `find`, `ls`.

AgentSession 的 registry 过滤 built-in、extension、SDK custom tools，并将 active tool loadout 限制在 allow/deny 集合中。限制：这是静态/会话级 name policy，不是基于参数的细粒度 capability。

[`packages/coding-agent/src/core/agent-session.ts#L2766-L2781`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/agent-session.ts#L2766-L2781)

```ts
private _refreshToolRegistry(options?: { activeToolNames?: string[]; includeAllExtensionTools?: boolean }): void {
  const allowedToolNames = this._allowedToolNames;
  const excludedToolNames = this._excludedToolNames;
  const isAllowedTool = (name: string): boolean =>
    (!allowedToolNames || allowedToolNames.has(name)) && !excludedToolNames?.has(name);
  const registeredTools = this._extensionRunner.getAllRegisteredTools();
  const allCustomTools = [
    ...registeredTools,
    ...this._customTools.map((definition) => ({ definition, sourceInfo: ... })),
  ].filter((tool) => isAllowedTool(tool.definition.name));
```

### 8. 通用审批由 `tool_call` 扩展 gate 实现

Pi 的 runtime 在参数 schema 校验后调用 `beforeToolCall`；coding-agent 将它接到扩展 `tool_call` 事件。事件结果支持 `block`、`reason`、`terminate`，且处理器可以修改输入。限制：文档注释明确“修改后不重新校验”，因此扩展修改参数时不能假定 runtime 会再次做 schema/path 安全检查。

[`packages/agent/src/agent-loop.ts#L662-L722`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/agent/src/agent-loop.ts#L662-L722)

```ts
const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
if (!tool) return { kind: "immediate", result: createErrorToolResult(`Tool ${toolCall.name} not found`), isError: true };
const preparedToolCall = prepareToolCallArguments(tool, toolCall);
const validatedArgs = validateToolArguments(tool, preparedToolCall);
if (config.beforeToolCall) {
  const beforeResult = await config.beforeToolCall({ toolCall, args: validatedArgs, context: currentContext }, signal);
  if (signal?.aborted) return { kind: "immediate", result: createErrorToolResult("Operation aborted"), isError: true };
  if (beforeResult?.block) {
    const result = createErrorToolResult(beforeResult.reason || "Tool execution was blocked");
    if (beforeResult.terminate === true) result.terminate = true;
    return { kind: "immediate", result, isError: true };
  }
}
```

[`packages/coding-agent/src/core/extensions/types.ts#L939-L944`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/extensions/types.ts#L939-L944)

```ts
/**
 * Fired before a tool executes. Can block.
 *
 * `event.input` is mutable. Mutate it in place to patch tool arguments before execution.
 * Later `tool_call` handlers see earlier mutations. No re-validation is performed after mutation.
 */
export type ToolCallEvent =
  | BashToolCallEvent
  | PowerShellToolCallEvent
  | ReadToolCallEvent
  | EditToolCallEvent
```

### 9. 例子中的一次性审批是扩展私有状态，不是平台语义

仓库示例用 dangerous command 正则匹配 `rm`、`sudo`、`chmod/chown 777`，有 UI 时 `select`，无 UI 时直接 block。它没有“记住允许”的分支；保护路径示例则对 `.env`、`.git/`、`node_modules/` 永久按扩展逻辑阻断。限制：这些只是 example extension，默认不会自动加载，且 `protectedPaths.some(path.includes(...))` 不是规范化路径匹配。

[`packages/coding-agent/examples/extensions/permission-gate.ts#L10-L32`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/examples/extensions/permission-gate.ts#L10-L32)

```ts
export default function (pi: ExtensionAPI) {
  const dangerousPatterns = [/\brm\s+(-rf?|--recursive)/i, /\bsudo\b/i, /\b(chmod|chown)\b.*777/i];
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;
    const command = event.input.command as string;
    const isDangerous = dangerousPatterns.some((p) => p.test(command));
    if (isDangerous) {
      if (!ctx.hasUI) return { block: true, reason: "Dangerous command blocked (no UI for confirmation)" };
      const choice = await ctx.ui.select(`Dangerous command: ${command}`, ["Yes", "No"]);
      if (choice !== "Yes") return { block: true, reason: "Blocked by user" };
    }
    return undefined;
  });
}
```

## 路径、命令、网络与外部工具

### 10. 官方内置 sandbox 缺失，真实边界交给 OS/容器

官方 security 文档明确：内置工具和扩展以 Pi 进程权限运行，包安装、shell、language server、测试命令都是普通本地进程；真正隔离必须来自 OS 或 virtualization/container。限制：容器配置错误、宿主 bind mount 或泄露 `~/.pi/agent` 仍可能破坏边界。

[`packages/coding-agent/docs/security.md#L31-L53`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/security.md#L31-L53)

> ## No Built-in Sandbox
> 
> Pi does not include a built-in sandbox. Built-in tools can read files, write files, edit files, and run shell commands with the permissions of the pi process. Extensions are TypeScript modules that run with the same permissions.
> 
> Package installs, shell commands, language servers, test commands, and other developer tools behave as ordinary local processes.
> 
> This is intentional. ... Real isolation needs to come from the operating system or a virtualization/container boundary.
> 
> Project trust is only an input-loading guard. ... Prompt injection from repository files, comments, documentation, context files, or build output is expected local-agent risk and cannot be reliably prevented by pi.

### 11. 可选 sandbox 扩展才提供 network/filesystem policy

仓库附带的 sandbox example 使用 `@anthropic-ai/sandbox-runtime`，在 macOS 使用 `sandbox-exec`、Linux 使用 `bubblewrap`，对 bash 做 OS-level wrapping；配置含允许/拒绝域名、读/写路径。限制：它只覆盖被扩展接管的 bash 和 `user_bash`；其他 custom extension tool 仍在 host 上运行，除非它们也主动委托。

[`packages/coding-agent/examples/extensions/sandbox/index.ts#L1-L29`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/examples/extensions/sandbox/index.ts#L1-L29)

```ts
/**
 * Sandbox Extension - OS-level sandboxing for bash commands
 *
 * Uses @anthropic-ai/sandbox-runtime to enforce filesystem and network
 * restrictions on bash commands at the OS level (sandbox-exec on macOS,
 * bubblewrap on Linux).
 *
 * Example .pi/sandbox.json:
 * {
 *   "network": { "allowedDomains": ["github.com", "*.github.com"] },
 *   "filesystem": {
 *     "denyRead": ["~/.ssh", "~/.aws"],
 *     "allowWrite": [".", "/tmp"],
 *     "denyWrite": [".env"]
 *   }
 * }
```

[`packages/coding-agent/examples/extensions/sandbox/index.ts#L132-L143`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/examples/extensions/sandbox/index.ts#L132-L143)

```ts
function createSandboxedBashOps(): BashOperations {
  return {
    async exec(command, cwd, { onData, signal, timeout }) {
      if (!existsSync(cwd)) throw new Error(`Working directory does not exist: ${cwd}`);
      const wrappedCommand = await SandboxManager.wrapWithSandbox(command);
      return new Promise((resolve, reject) => {
        const child = spawn("bash", ["-c", wrappedCommand], {
          cwd,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
```

### 12. 外部 tool / MCP 不是 built-in permission surface

Pi 文档把 MCP、permission popups、background bash 等列为有意不内置的 workflow；扩展和 package 是替代机制。限制：这不等于 Pi 不能接入外部工具，而是接入后由扩展作者、宿主和外部 sandbox 自己承担安全决策。

[`packages/coding-agent/docs/usage.md#L305-L311`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/usage.md#L305-L311)

> ## Design Principles
> 
> Pi keeps the core small and pushes workflow-specific behavior into extensions, skills, prompt templates, and packages.
> 
> It intentionally does not include built-in MCP, sub-agents, permission popups, plan mode, to-dos, or background bash.
> 
> You can build or install those workflows as extensions or packages, or use external tools such as containers and tmux.

## 非交互、失败、取消与恢复

### 13. 非交互 trust 是无 UI 的 fail-closed，但工具审批没有默认等价物

官方文档规定 `-p`、`--mode json`、`--mode rpc` 不显示 trust prompt；无保存决定时 `ask`/`never` 忽略项目资源，`always` 才信任，CLI 可用 `--approve`/`--no-approve` 覆盖一次。限制：这只覆盖 project resource loading；没有 permission-gate 扩展时，bash 仍按宿主权限执行。

[`packages/coding-agent/docs/security.md#L18-L35`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/security.md#L18-L35)

> When an interactive session starts ... the default value is `"ask"`, which asks whether to trust the project when UI is available.
> 
> Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a trust prompt.
> Without an applicable saved trust decision, `defaultProjectTrust: "ask"` and `"never"` ignore such resources, while `"always"` trusts them.
> Use `--approve`/`-a` or `--no-approve`/`-na` to override project trust for one run.
> 
> ## No Built-in Sandbox
> 
> Pi does not include a built-in sandbox.

### 14. 阻断/取消会进入 tool result 和 abort signal 语义

agent loop 在 block 后产生 error tool result；执行阶段和 shell tool 都观察 `AbortSignal`，bash abort 会 kill 整个 process tree。限制：已启动的外部副作用不能由 Pi 的 transcript 回滚；abort 只表达停止等待/杀进程，不是事务撤销。

[`packages/agent/src/agent-loop.ts#L697-L715`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/agent/src/agent-loop.ts#L697-L715)

```ts
if (beforeResult?.block) {
  const result = createErrorToolResult(beforeResult.reason || "Tool execution was blocked");
  if (beforeResult.terminate === true) result.terminate = true;
  return { kind: "immediate", result, isError: true };
}
if (signal?.aborted) {
  return {
    kind: "immediate",
    result: createErrorToolResult("Operation aborted"),
    isError: true,
  };
}
return { kind: "prepared", toolCall, tool, args: validatedArgs };
```

[`packages/coding-agent/src/core/tools/bash.ts#L107-L146`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/tools/bash.ts#L107-L146)

```ts
const onAbort = () => {
  if (child.pid) killProcessTree(child.pid);
};
try {
  if (timeoutMs !== undefined) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      if (child.pid) killProcessTree(child.pid);
    }, timeoutMs);
  }
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const exitCode = await waitForChildProcess(child);
```

### 15. `terminate` 是 batch 级语义，不是单个 deny 后必然停止

`shouldTerminateToolBatch` 只有在 finalized calls 非空且每个结果都有 `terminate: true` 时返回 true。限制：并行 tool batch 中一个 deny 不会自动阻止其他已获准调用；策略需要在并行模式下考虑 side effect race。

[`packages/agent/src/agent-loop.ts#L542-L615`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/agent/src/agent-loop.ts#L542-L615)

```ts
const orderedFinalizedCalls = await Promise.all(
  finalizedCalls.map((entry) => (typeof entry === "function" ? entry() : Promise.resolve(entry))),
);
const messages: ToolResultMessage[] = [];
for (const finalized of orderedFinalizedCalls) {
  const toolResultMessage = createToolResultMessage(finalized);
  await emitToolResultMessage(toolResultMessage, emit);
  messages.push(toolResultMessage);
}
return {
  messages,
  terminate: shouldTerminateToolBatch(orderedFinalizedCalls),
};
```

### 16. session 恢复的是 tool loadout，不是审批状态

新 session 记录 model/thinking；如果没有显式 initial tool loadout，AgentSession 从当前 transcript system message 的 `toolsAdded` 恢复当前工具名，再通过 registry 过滤。限制：源码没有 session entry 类型保存“用户允许过某命令/路径”；project trust 和 sandbox 初始化分别由外部文件/`session_start` 决定。

[`packages/coding-agent/src/core/agent-session.ts#L402-L414`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/agent-session.ts#L402-L414)

```ts
this._buildRuntime({
  activeToolNames: this._initialActiveToolNames,
  includeAllExtensionTools: true,
});
if (this._initialActiveToolNames === undefined) this._restoreToolsFromTranscript();
```

[`packages/coding-agent/src/core/agent-session.ts#L1158-L1169`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/agent-session.ts#L1158-L1169)

```ts
private _restoreToolsFromTranscript(): void {
  const current = getCurrentSystemMessage(this.sessionManager.buildSessionContext().messages);
  if (!current) return;
  const toolNames = (current.toolsAdded ?? [])
    .map((tool) => tool.name)
    .filter((name) => this._toolRegistry.has(name));
  this.agent.state.tools = toolNames.flatMap((name) => {
    const registered = this._toolRegistry.get(name);
    return registered ? [registered] : [];
  });
  this._rebuildSystemPrompt(toolNames);
}
```

### 17. RPC 是可编排的 UI/取消边界，不是权限边界

RPC mode 把 extension `select`/`confirm` 请求发送给 host，并把取消映射为默认值；`abort` 会等待 session idle。限制：协议没有 approval token、审批持久化字段、策略版本或 host 身份认证；安全性取决于 RPC 宿主如何实现请求。

[`packages/coding-agent/src/modes/rpc/rpc-mode.ts#L133-L160`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/modes/rpc/rpc-mode.ts#L133-L160)

```ts
const createExtensionUIContext = (): ExtensionUIContext => ({
  select: (title, options, opts) =>
    createDialogPromise(opts, undefined, { method: "select", title, options, timeout: opts?.timeout }, ...),
  confirm: (title, message, opts) =>
    createDialogPromise(opts, false, { method: "confirm", title, message, timeout: opts?.timeout }, ...),
  input: (title, placeholder, opts) =>
    createDialogPromise(opts, undefined, { method: "input", title, placeholder, timeout: opts?.timeout }, ...),
  notify(message, type) {
    output({ type: "extension_ui_request", id: crypto.randomUUID(), method: "notify", message, notifyType: type });
  },
});
```

[`packages/coding-agent/docs/rpc.md#L124-L158`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/rpc.md#L124-L158)

> #### abort
> 
> Abort the current operation and wait for the session to become idle before responding.
> 
> ```json
> {"type": "abort"}
> ```
> 
> `clear_queue` removes queued steering and follow-up messages. To implement interactive Esc behavior, send `clear_queue` before `abort`.

## 具体 Trace：一次危险 bash 调用

场景：模型生成 `bash({command: "sudo rm -rf build"})`，加载了仓库的 `permission-gate` 扩展，处于无 UI 的 `--mode rpc`。

1. **工具存在性与参数校验**：agent loop 在 `currentContext.tools` 查找 `bash`，调用 `validateToolArguments`，再进入 `beforeToolCall`。[源码](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/agent/src/agent-loop.ts#L662-L690)
2. **扩展接管**：AgentSession 把 `beforeToolCall` 转成 `runner.emitToolCall({ toolName, toolCallId, input })`。[源码](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/agent-session.ts#L490-L510)
3. **策略判断**：`permission-gate` 对 `bash` 的 command 做正则检查；匹配 `sudo` 或 `rm -rf`，发现 `ctx.hasUI === false`，返回 `{ block: true, reason }`。[源码](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/examples/extensions/permission-gate.ts#L13-L29)
4. **拒绝投影**：agent loop 不调用 `prepared.tool.execute`，而是生成 `ToolResultMessage`，`isError: true`，内容为 reason。[源码](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/agent/src/agent-loop.ts#L697-L707)
5. **后续行为**：因为示例没有设置 `terminate: true`，当前 tool batch 的终止提示不会被设置；模型可能看到错误后继续提出下一轮调用。若多个并行调用中只有该调用被 block，其他调用仍可能执行。[源码](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/agent/src/agent-loop.ts#L644-L645)

这个 trace 的安全含义：Pi 的审批是一个可插拔的“执行前 veto”，不是命令解释器或 OS policy。只要扩展没覆盖某个 tool，那个 tool 就按其自身实现执行。

## 跨进程边界与外部隔离

官方 containerization 文档把隔离分成两类：整个 Pi 进程进入容器，或 host Pi 将内置工具路由到隔离环境。限制：host Pi + tool routing 只覆盖被 routing 的工具；其他扩展工具仍在 host 上。

[`packages/coding-agent/docs/containerization.md#L1-L18`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/containerization.md#L1-L18)

> Pi runs with all permissions by default...
> 
> 1. run the whole `pi` process inside an isolated environment, or
> 2. run `pi` on the host and route tool execution into an isolated environment.
> 
> | Pattern | What is isolated |
> | --- | --- |
> | Gondolin extension | Built-in tools and `!` commands |
> | Plain Docker | Whole `pi` process in a local container |
> | OpenShell | Whole `pi` process in a policy-controlled sandbox |
> 
> Extensions run wherever the `pi` process runs. ... other custom extension tools still run on the host unless they also delegate their operations.

OpenShell 被文档描述为同时控制 filesystem、process、network、credential、inference 的 policy-controlled sandbox；远程 gateway 下 workspace 不再 bind mount 回 host，结果需要显式 upload/download。限制：这是 OpenShell 的边界，不是 Pi 的 policy engine。

[`packages/coding-agent/docs/containerization.md#L80-L112`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/containerization.md#L80-L112)

> Use [NVIDIA OpenShell](https://docs.nvidia.com/openshell/about/overview) when you want a policy-controlled sandbox with filesystem, process, network, credential, and inference controls.
> 
> In this pattern, the whole `pi` process runs inside the sandbox.
> Built-in tools, `!` commands, and extension tools execute inside the OpenShell boundary.
> 
> If the gateway is remote, project files are not bind-mounted from the host, meaning writes in the sandbox are not reflected on your machine.
> Clone the repository inside the sandbox or use OpenShell file transfer commands.
> 
> OpenShell providers can keep raw model API keys outside the sandbox.

## 失败模式与边界

| 场景 | Pi 行为 | 限制/风险 | 证据 |
|---|---|---|---|
| trust 无 UI、无保存决定 | `ask`/`never` 不加载项目资源 | 只保护加载，不保护已有 host 工具能力 | [`security.md#L27-L35`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/security.md#L27-L35) |
| tool_call 返回 block | 生成 error tool result，不执行 tool | 不设置 terminate 可能继续下一轮 | [`agent-loop.ts#L697-L707`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/agent/src/agent-loop.ts#L697-L707) |
| 并行 batch 中部分调用被拒绝 | 其他调用可并行执行，最后按 batch 计算 terminate | 可能在拒绝决定后仍有副作用 | [`agent-loop.ts#L542-L615`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/agent/src/agent-loop.ts#L542-L615) |
| bash timeout/abort | kill detached child process tree；返回 timeout/aborted error | 不是事务回滚；子进程外部副作用不可撤销 | [`bash.ts#L107-L146`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/tools/bash.ts#L107-L146) |
| trust.json 损坏 | JSON parse/结构校验抛异常 | 没有本文档可证实的安全降级策略 | [`trust-manager.ts#L98-L123`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/src/core/trust-manager.ts#L98-L123) |
| workspace read/write bind mount | 容器内写入直接改 host 文件 | bind mount 本身不能提供复制隔离 | [`containerization.md#L69-L78`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/containerization.md#L69-L78) |
| host Pi + routing extension | 被覆盖的 built-in tool 进入 VM | 未覆盖的 custom extension tool 仍在 host | [`containerization.md#L11-L18`](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/docs/containerization.md#L11-L18) |

## 测试证据

1. **allowlist 回归测试**验证显式列表同时过滤 built-in 和 extension tool；空列表让 `getAllTools()` 与 active tools 都为空。[测试](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/test/suite/regressions/2835-tools-allowlist-filters-extension-tools.test.ts#L12-L93)

```ts
it("allows only explicitly listed built-in and extension tools", async () => {
  const session = await createSession(["read", "dynamic_tool"]);
  expect(session.getActiveToolNames().sort()).toEqual(["dynamic_tool", "read"]);
  expect(session.systemPrompt).not.toContain("- bash:");
  expect(session.systemPrompt).not.toContain("- edit:");
});
```

2. **trust store 测试**验证父目录继承、子目录覆盖、删除子决定后恢复父决定，以及 `.pi/settings.json` / `.agents/skills` 资源检测。[测试](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/test/trust-manager.test.ts#L24-L65)

```ts
store.set(parentDir, true);
expect(store.get(childDir)).toBe(true);
store.set(childDir, false);
expect(store.get(childDir)).toBe(false);
store.set(childDir, null);
expect(store.get(childDir)).toBe(true);
```

3. **blocked-tool 测试**验证 block handler 可以阻止实际 tool execution，并用 `terminate: true` 让后续 assistant response 不再运行。[测试](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/test/suite/regressions/5998-blocked-tool-terminate.test.ts#L16-L52)

```ts
pi.on("tool_call", async () => ({
  block: true,
  reason: "Blocked by terminating policy",
  terminate: true,
}));
expect(getAssistantTexts(harness)).not.toContain("should not run");
```

4. **bash 测试**覆盖 timeout、abort error、无效 cwd、shell spawn error、输出截断和完整输出临时文件。[测试](https://github.com/earendil-works/pi/blob/36b60d2e8985899743c4cf5bd5f8929832a3f05d/packages/coding-agent/test/tools.test.ts#L545-L604)

## 作者/维护者说法与 issue/PR

官方文档和源码是当前行为的主要证据。作者/维护者本人对“为什么不内置 permission popup / sandbox”的直接、带版本设计说明，本次未找到比仓库文档更强的一手材料；仓库 README 仅给出当前设计边界。限制：以下 issue/PR 是社区或贡献提案，不能升级为已实现功能。

- 社区提案 [#8802 Add a `permissions` block to settings.json](https://github.com/earendil-works/pi/issues/8802) 试图加入 Codex 风格 profile、package allowlist、extension hash；该 issue 于 2026-08-28 被自动关闭，正文描述的是“当前缺少 first-class”而不是已合入设计。
- 社区提案 [#9043 add an opt-in capability policy hook to pi-agent-core](https://github.com/earendil-works/pi/issues/9043) 明确描述当前 Pi 仍“runs tools with the permissions of the host process”，并把 single-use approval UI、network isolation、credential isolation 留给 host integrations；该 issue 于 2026-09-03 自动关闭，不能视为现行 API。
- PR [#7548 fix(coding-agent): sandbox issue analysis tools](https://github.com/earendil-works/pi/pull/7548) 的说明提出：只向模型暴露 `read,bash`、复制 workspace、无网络、非 root、drop capabilities、sandbox unavailable 时 fail closed；PR 当前仍 open，因此只能作为实践方向和边界案例，不能证明已进入 pinned commit。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | README、`security.md`、`containerization.md`、`usage.md`、trust manager、project trust、tool registry、agent loop、RPC、bash/file tools，均按 `36b60d2e8985899743c4cf5bd5f8929832a3f05d` 引用。 |
| 作者或维护者本人的说法 | 未找到比 pinned README/security docs 更直接的作者设计说明；`usage.md` 链接到作者 blog，但本次没有把博客内容当作源码行为证据。 |
| 同类方案 | 按用户边界本次不查 pi 之外的三个项目；此行记录为“不适用：用户要求只研究 pi agent”。 |
| issue / PR / 社区实践 | 查了 #8802、#9043、#7548、#7787；提案说明当前缺口和外部 sandbox 实践，但没有把未合入 issue/PR 当作当前行为。 |
| 历史演变 | 在 pinned checkout 中检查了 security/sandbox 文件的 git history；该 shallow checkout 只有当前 commit，无法证明更早版本的演变，故不据此推断历史迁移。 |

## 待验证

1. `badlogic/pi-mono` 重定向到 `earendil-works/pi` 的完整 GitHub redirect 历史和 package 发布版本映射，需要非 shallow 的仓库历史或 release 元数据才能继续钉定。
2. RPC host 是否在某个官方 UI 实现中把 `extension_ui_request` 映射为持久 approval decision；当前 RPC 协议源码只证实请求/响应/取消，没有证实 UI 产品策略。
3. `@anthropic-ai/sandbox-runtime` 自身的网络代理、DNS、符号链接和子进程逃逸语义；Pi 只调用 `wrapWithSandbox`，不能从 Pi 源码证明第三方 runtime 的完整强制性。
4. 外部扩展 tool 是否会在特定宿主模式下自动继承 active tool allowlist 之外的权限；当前源码能证明 tool name 过滤，但不能证明所有 extension 内部副作用都被统一拦截。
5. trust store JSON 损坏时的产品级恢复体验；源码显示抛异常，尚未实测 CLI/TUI 如何展示和退出。

## 对本项目的影响

- 如果 `jai-mono` 需要 Pi 风格的最小实现，应把“资源加载 trust”“tool name exposure”“执行前 policy veto”“OS/container sandbox”分成四个不同事实/边界，不要把它们统称为一个 permission state。
- 需要审批语义时，应在统一的 tool preflight 边界提供结构化 decision、reason、terminate/batch policy，并明确一次性/会话级/持久授权是否 durable；Pi 的 example gate 不能直接当作完整权限系统。
- 需要文件、shell、网络、凭据真正隔离时，应把 enforcement 放在 OS/container/remote executor，且明确 host Pi 模式下哪些 extension tool 没有被路由。
- 恢复设计应分别持久化“工具暴露配置”“trust decision”“审批决定”“sandbox profile”；Pi 只持久化 session transcript 的 tool loadout 与独立 trust store，没有通用 approval journal。
