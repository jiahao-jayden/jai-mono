# E2B 的 realpath 与 workspace 边界

核验日期：2026-08-26。

版本钉死：`e2b@2.46.0`，对应 E2B 官方仓库
[`e2b-dev/E2B@d42686d`](https://github.com/e2b-dev/E2B/tree/d42686d982f741b01f2c71da304e63846b34706f)。该版本号由已解包
SDK 的 `packages/js-sdk/package.json` 核对；该 tag 到 SHA 的映射沿用
[`e2b-filesystem-2026-08-26.md`](../../docs/research/e2b-filesystem-2026-08-26.md)
已记录的官方 tag Atom 核验。本文所有源码链接固定到此 commit，以免后续 SDK
变化改变结论。E2B 官方文档/仓库的在线复抓受本机失效代理阻断；以下事实均由
该官方源码包与协议原文复核，不使用第三方转述。

## 结论

1. **可以在 E2B sandbox 内执行 `realpath`，但这是“运行一条 Linux 命令并拿到一个路径字符串”，不是 E2B Filesystem API 的能力。** `commands.run(cmd, { cwd })` 的实现把 `cmd` 作为 `/bin/bash -l -c` 的参数，所以若 JAI 的固定 template 安装了 GNU coreutils（或任何提供 `realpath` 的程序），`commands.run("realpath -- …")` 可以工作。`realpath` 是否存在、输出格式和版本都应视为该 template 的显式依赖，不能从 E2B SDK 默认保证推出。 [Commands options](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L46-L90) [bash execution](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L426-L464)

2. **E2B 的公开 Filesystem 协议没有 `realpath`、`openat`/dirfd、`base`、`boundary`、或“resolve 后在同一次操作中使用”的 RPC。** `getInfo`/`list` 只能报告一个 symlink 的直接 target；其 `EntryInfo.path` 也没有 canonical 的语义。Host 可以自行递归解释该字符串，或先跑 `realpath`，但两者都不能把解析结果绑定到之后的 `read`、`write`、`move` 或命令执行。 [Filesystem RPC 列表](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/spec/envd/filesystem/filesystem.proto#L7-L20) [symlink 字段](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/spec/envd/filesystem/filesystem.proto#L53-L76)

3. **因此，`realpath` + 下一次 E2B 文件调用只能作诊断或预检，不能构成无 TOCTOU 的 workspace 强制边界。** 解析与读取是不同的请求：SDK 对 `read` 发出 `GET /files?path=…`，对 `write` 发出 `POST /files?path=…`；中间可以有另一个 process 将路径成分替换为 symlink。协议没有 capability token、文件 handle、目录 FD、预期 inode 或 atomic resolve-and-open 参数可交给第二个请求验证。这个结论由协议和 SDK 请求形状直接推出，不猜测 envd 内部实现。 [read 的 path 传递](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/filesystem/index.ts#L532-L546) [write 的 path 传递](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/filesystem/index.ts#L689-L724) [stat 的 path 传递](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/filesystem/index.ts#L1003-L1028)

4. **`cwd` 也不是 confinement。** 它只是传给 shell process 的 working directory；调用方控制的 `cmd` 仍由 bash 解释，可以引用绝对路径、父目录和任意此 sandbox user 可访问的路径。因此 `commands.run(command, { cwd: "/workspace" })` 不能把 Bash 工具限制在 `/workspace` 内。 [cwd 的 API 注释](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L52-L63) [实际 Process 请求](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L447-L456)

5. **沙箱布局能解决的，是“把整个 sandbox 作为一个 tenant/session 的机器”，不是在该机器内再得到一个 E2B 原生的路径 capability。** E2B template 可由 Dockerfile 构建，能够固定 `RUN`、`COPY`、`WORKDIR`、`USER`；所以我们能构建仅放置这个 Session workspace、受信任 skills/plugins 和无业务 secrets 的 image，并把 sandbox-wide access 作为云端 Agent 的权限模型。这足够隔离其他 sandbox，却不等价于“任何工具都不可能访问 `/workspace` 外的 sandbox 文件”。 [Dockerfile template 入口](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/template/index.ts#L517-L531) [模板支持的 `RUN`/`COPY`/`WORKDIR`/`USER`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/template/dockerfileParser.ts#L96-L160)

6. **若产品真的要求“workspace 内、阻止 symlink escape、并且文件操作和 Bash 都强制执行”，可以在 E2B 上实现，但要由 JAI 另建 sandbox-side confinement，不是恢复一个 `canonicalPath: string` 就能得到。** 可信 sandbox-side service 应自己使用操作系统的 fd-relative / kernel-enforced 路径机制（例如 Linux `openat2` 的 `RESOLVE_BENEATH`、禁止 symlink 的策略），并以受限 root/mount namespace 启动 Bash；此外 Tools/Extensions 只能调用该服务，不能获得原始 `sandbox.files` 或 `sandbox.commands`。E2B 当前公开 SDK/API 没有声明此类受限根、mount namespace 或 bound filesystem operation，所以该方案需要我们拥有、审计和集成测试的 template/sidecar；不能把它称作 E2B 已提供的 adapter 行为。

## 三种做法的边界

| 做法 | 能得到什么 | 不能保证什么 | 适合的 JAI 语义 |
| --- | --- | --- | --- |
| `commands.run("realpath -- path")` | 当前 sandbox 状态下的解析后字符串；可用于日志、错误信息、预检 | 与后一个 read/write/bash 没有关联；程序是否存在由 template 决定 | 诊断；不授权 |
| `files.getInfo()` + `symlinkTarget` | stat 和一跳 link target | 非递归 canonical path；没有 boundary；没有 handle；有请求间竞态 | UI / 元数据；不授权 |
| sandbox-wide workspace | 一个 E2B sandbox 是一个 Session 的完整机器；Workspace、trusted assets 都在其内 | 不禁止 Agent 访问同一 sandbox 的其他可访问路径 | 当前云 Agent 推荐的模型 |
| 自建 sidecar + OS confinement | 可把 path operation 和执行 root 绑定到 kernel 强制边界 | 不是 E2B 标准能力；需单独设计、持续审计及验收 | 将来若 workspace-only 是安全产品承诺 |

### 预检为何会产生竞态

```text
JAI Host                         E2B sandbox
--------                         -----------
commands.run("realpath x")  ->  /workspace/allowed/file
                                 （x 或其父目录被替换为 symlink）
files.read("x")             ->  新目标的内容
```

`realpath` 的返回值没有被 E2B 下一个 `/files` 请求接受、验证或持有，因此它
无法证明第二行仍访问第一次解析的 object。对任意 Bash 更明显：Bash 本身可以
直接写它想写的绝对路径，完全绕开预检。

这不是说 Local 一定天然没有竞态。当前 `NodeExecutionEnvironment` 也是在
`realpath`/比较之后，以路径字符串再次调用 Node 文件 API；它在调用前重新检查，
可捕获大多数误用和普通 symlink escape，但不是持有目录 FD 的内核级
resolve-and-open primitive。故不应把 `PathCapabilityManager` 的
`canonicalPath` 描述成跨环境可复制的“无竞态证明”。这是一个独立的本地安全
强化议题，不是把该字段放回共同接口的理由。

## 对 Spec 01 与本项目的影响

**Spec 01 不应恢复 `canonicalPath` 到共同 `ExecutionEnvironment` contract。**

之前“E2B 没有 `realpath`”这个说法需要收窄为：**E2B 没有原生、可绑定到后续
operation 的 `realpath` / workspace-bound operation。** 若固定 template，的确
可以通过 Bash 取到一个 canonical-looking string；但将它作为共有
`canonicalPath` 会二选一地造成错误：

- 若字段只表示字符串，它容易被调用方误当成授权凭据，且让所有 adapter 承担
  不必要的外部工具依赖；
- 若字段暗示 link-safe workspace authorization，E2B 标准 adapter 无法兑现，
  因为它没有同次 operation 的 enforcement primitive。

保留已落地的基线：`ExecutionEnvironment.resolvePath()` 仅产生环境内可操作
path；`PathCapabilityManager` 保持可选的 local adapter 附加能力。云端的首版
权限模型应明确为 **bound E2B sandbox-wide environment**，并通过 pinned template
确保不会在 workspace 旁放 tenant/business secret。若将来必须声明
“workspace-only”，新建一个有明确 enforcement 证据的 `WorkspaceBoundary` /
restricted-executor capability（以及 sandbox-side 设计与对抗性 symlink tests），
不要把它伪装成 `canonicalPath`。
