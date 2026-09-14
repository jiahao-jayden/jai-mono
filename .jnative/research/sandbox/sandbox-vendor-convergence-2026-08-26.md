# 沙箱执行环境 SDK：共同形状与分歧（2026-08-26）

## 结论

1. **核心工作单元已明显收敛：可持久标识的 sandbox/handle，加文件系统，加命令执行。** E2B、Daytona、Modal、Cloudflare 都把使用入口做成可反复取得的运行环境对象，而非一次性 HTTP 请求；名称、构造位置和连接语义不同。
2. **文件读、覆盖写、列目录与一次性命令是共同的最低层形状。** 四家都有这些能力，命名从 `read/write` 到 `download/upload` 不同；`cwd`、环境变量和逐命令超时也几乎都能传入。
3. **文件元数据没有完全收敛。** E2B、Modal、Cloudflare 的公开 entry type 都能区分 `file`、`directory`、`symlink`；Daytona 当前公开文档只稳定展示 `isDir`。原子写和 append 在四家都不是可依赖的共同承诺。
4. **真实路径/符号链接解析是明确的共同缺口，而非共同接口。** E2B、Modal 可在元数据中观察 symlink target，Cloudflare 可识别 symlink type；四家已核验的公共 SDK/API 均未提供稳定的 `realpath`/canonical-path 契约。因此不能把供应商 API 当作本项目路径越界防护的依据。
5. **一次性命令的结果模型已分叉。** E2B、Cloudflare 是 `run/exec -> stdout + stderr + exit code`；Modal 的 `exec` 立即给 `ContainerProcess`，由三条 stdio 流和 `wait()` 组成结果；Daytona 文档只承诺 `result + exitCode`。所以“同步收集输出的 execute”可做本项目投影，但不应误当为底层共同契约。
6. **流输出与长生命周期交互是最大接口分歧之一。** E2B 用 stdout/stderr callback 加可写 stdin 的 command handle；Modal 用 async-iterable reader/writer；Daytona 用 session/PTY、callback 和按 ID 重连；Cloudflare 的 background `Process` 没有 stdin，双向交互要改走 WebSocket PTY。
7. **暂停/恢复是第二个最大分歧。** E2B 有同一 sandbox 的 pause，并可选保留完整内存或仅文件系统；Daytona 只把 pause/resume 与 memory snapshot 标成 VM feature，当前公开文档未给状态保证；Modal 只有实验性 snapshot 后创建新 sandbox；Cloudflare 是 idle sleep/eviction，且没有状态保留式 resume 保证。
8. **超时不是一个通用字段。** 所有家都有某种 per-command timeout，但还各自叠加生命周期、idle、连接/ready 或 session deadline；不能让一个 `timeoutMs` 同时承担这些语义。
9. **对契约选择的判断：应定义自己的 `ExecutionEnvironment`，以各厂商共同的最低层形状为依据，再由 adapter 实现。** 直接采用任一家 API 会把其进程流、生命周期和链接语义泄漏成产品承诺，尤其会锁定第 5、8、9 维度的取舍。

## 核验信息

核验日期：**2026-08-26**。源码链接均钉到 commit SHA，避免活跃分支后续变更混入结论；Daytona 的核心开发已在 2026-06 移入私有仓库，因此当前接口以官方文档访问日而非旧公开源码为准。

| 厂商 | 核验对象 |
| --- | --- |
| E2B | 官方 `e2b` JavaScript SDK `2.46.0`，提交 [`f0facc5dbcf93067326745e1597b05311c0174ea`](https://github.com/e2b-dev/E2B/tree/f0facc5dbcf93067326745e1597b05311c0174ea)。 |
| Daytona | 官方文档于 2026-08-26 访问；公开仓库提交 [`ec4c21b2d597091ac09ecc278f3bcc172575a987`](https://github.com/daytonaio/daytona/blob/ec4c21b2d597091ac09ecc278f3bcc172575a987/README.md) 说明核心开发已私有化。 |
| Modal | 官方 `modal-client` 提交 [`c1f8b92d1613beaf73aecc6b55281a038f1dfaf4`](https://github.com/modal-labs/modal-client/tree/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4)：Python `modal==1.5.4`，同提交 TypeScript `modal@0.9.0`。 |
| Cloudflare | 官方 `@cloudflare/sandbox` `0.12.8`，提交 [`664d8e36d22f2b8f286a9cac90551113afdb316c`](https://github.com/cloudflare/sandbox-sdk/tree/664d8e36d22f2b8f286a9cac90551113afdb316c)。 |

没有使用第三方博客或对比文章作为结论证据。

## 主体对比表

| 维度 | E2B | Daytona | Modal Sandbox | Cloudflare Sandbox / Containers |
| --- | --- | --- | --- | --- |
| 1. 沙箱创建/连接的形状 | [`Sandbox.create()`](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/index.ts#L285-L347) 返回 handle，`sandboxId` 可由 [`Sandbox.connect(id)`](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/index.ts#L350-L390) 重新取得；连接 paused sandbox 会自动恢复。 | `new Daytona(); daytona.create(params) -> Sandbox`，官方文档还描述按 ID/name 取 sandbox handle；当前 SDK 的公开源码不可得，按文档核验。[Sandboxes](https://www.daytona.io/docs/sandboxes/) | [`Sandbox.create(...)->Sandbox`](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/sandbox.py#L551-L646)，[`Sandbox.from_id(id)`](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/sandbox.py#L1301-L1334) 连接既有 handle。 | [`getSandbox(namespace, id, options)`](https://github.com/cloudflare/sandbox-sdk/blob/664d8e36d22f2b8f286a9cac90551113afdb316c/packages/sandbox/src/sandbox.ts#L760-L783) 按逻辑 ID 取得 Durable Object stub；未查到独立 `create` 或 remote connect-by-ID。 |
| 2. 文件读：方法名、参数、返回形态 | [`files.read(path, { format })`](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/filesystem/index.ts#L398-L451) 返回 text、`Uint8Array`、`Blob` 或 `ReadableStream<Uint8Array>`。 | `fs.downloadFile(path) -> Buffer`；大文件为 `downloadFileStream(path) -> Node stream`。[File System Operations](https://www.daytona.io/docs/file-system-operations/) | [`filesystem.read_bytes(path) -> bytes` / `read_text(path) -> str`](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/sandbox_fs.py#L275-L357)，路径必须绝对；首选 API 为全量读取。 | [`readFile(path, { encoding?, sessionId? })`](https://github.com/cloudflare/sandbox-sdk/blob/664d8e36d22f2b8f286a9cac90551113afdb316c/packages/sandbox/src/sandbox.ts#L5134-L5153) 返回 `{ content: string, ... }`；`encoding: 'none'` 返回原始 stream。[返回类型](https://github.com/cloudflare/sandbox-sdk/blob/664d8e36d22f2b8f286a9cac90551113afdb316c/packages/shared/src/types.ts#L631-L673) |
| 3. 文件写：方法名、是否原子、有没有 append | [`files.write(path, data)`](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/filesystem/index.ts#L572-L606) 创建父目录并覆盖已有文件；公开 opts 未声明原子 replace 或 append。[opts](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/filesystem/index.ts#L256-L301) | `fs.uploadFile(content, destination)`，另有 `uploadFiles`/`uploadFileStream`；原子性与 append 均未查到。[File System Operations](https://www.daytona.io/docs/file-system-operations/) | [`write_bytes(data, path)` / `write_text(data, path)`](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/sandbox_fs.py#L551-L638) 创建父目录、覆盖；原子性未声明。首选 API 无 append；弃用 Alpha `open(path, 'a')` 才有 append。[V1 open](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/sandbox.py#L2351-L2404) | [`writeFile(path, string\|ReadableStream, { encoding?, sessionId? })`](https://github.com/cloudflare/sandbox-sdk/blob/664d8e36d22f2b8f286a9cac90551113afdb316c/packages/sandbox/src/sandbox.ts#L5085-L5100)；公开契约未声明原子性，也无 append。 |
| 4. 列目录 / stat：entry 结构，有没有 file/dir/symlink 区分 | [`files.list(path)->EntryInfo[]`](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/filesystem/index.ts#L829-L864) 和 [`getInfo(path)`](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/filesystem/index.ts#L995-L1025)；entry 有 path/size/mode/owner/mtime/type/symlinkTarget，type 为 [`file/dir/symlink`](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/filesystem/index.ts#L86-L163)。 | `listFiles(path)` 展示 `name/isDir/size/modTime`；`getFileDetails(path)` 增加 mode/permissions。仅稳定展示 `isDir`，file/dir/symlink 三态未查到。[File System Operations](https://www.daytona.io/docs/file-system-operations/) | [`list_files(path)`](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/sandbox_fs.py#L183-L236) 与 [`stat(path)`](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/sandbox_fs.py#L405-L454) 返回 `FileInfo`；其 type 为 [`file/directory/symlink`](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/types.py#L176-L201)，并含 size/mode/permissions/owner/group/mtime/link target。 | [`listFiles(path)`](https://github.com/cloudflare/sandbox-sdk/blob/664d8e36d22f2b8f286a9cac90551113afdb316c/packages/shared/src/types.ts#L705-L738) entry 有 path/size/mtime/mode/permissions，type 为 `file/directory/symlink/other`；公开 API 只有 `exists`，独立 `stat` 未查到。 |
| 5. 有没有 realpath 或符号链接解析 | 公开 filesystem surface 未查到 `realpath`/`readlink`；[`EntryInfo.symlinkTarget`](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/filesystem/index.ts#L111-L163) 仅暴露 link target。 | CRUD、permission、search 等文档 API 中未查到 `realpath`、`readlink` 或链接解析契约。[File System Operations](https://www.daytona.io/docs/file-system-operations/) | 已核验 public methods 未查到 `realpath`/`readlink`；[`stat` 对叶子 symlink 返回链接本身及 `symlink_target`](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/sandbox_fs.py#L405-L450)，不是 canonical path。 | 公开接口只暴露 symlink type；未查到 `realpath`、`readlink`、创建链接或解析 target。[接口全集](https://github.com/cloudflare/sandbox-sdk/blob/664d8e36d22f2b8f286a9cac90551113afdb316c/packages/shared/src/types.ts#L1402-L1433) |
| 6. 一次性命令执行：方法名、参数、返回 | [`commands.run(cmd, { cwd, envs, timeoutMs, onStdout, onStderr })`](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/commands/index.ts#L44-L91) 默认等待，返回 [`{ exitCode, stdout, stderr }`](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/commands/commandHandle.ts#L17-L38)（nonzero 抛 `CommandExitError`）。 | `process.executeCommand(command, cwd?, env?, timeout?)`；timeout 为秒。文档展示 `result + exitCode`，独立 stdout/stderr 返回未查到。[Process and Code Execution](https://www.daytona.io/docs/process-code-execution/) | [`sandbox.exec(*args, stdout, stderr, timeout, workdir, env, ...) -> ContainerProcess`](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/sandbox.py#L2021-L2061)；由 [`stdout/stderr.read()` 与 `wait()->int`](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/container_process.py#L132-L187) 组合结果。 | [`exec(command, { timeout, env, cwd, ... })`](https://github.com/cloudflare/sandbox-sdk/blob/664d8e36d22f2b8f286a9cac90551113afdb316c/packages/shared/src/types.ts#L17-L118) 返回 `success/exitCode/stdout/stderr/command/duration`。 |
| 7. 流式输出：callback？async iterable？stream？ | `commands.run` 的 [`onStdout` / `onStderr` callback](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/commands/index.ts#L71-L90)。 | session command 用 `getSessionCommandLogs(..., onStdout, onStderr)` callback；PTY 的 `onData` 也是 callback。[Process](https://www.daytona.io/docs/process-code-execution/) [PTY](https://www.daytona.io/docs/pty/) | [`stdout`/`stderr` `StreamReader` 可 `async for` 读 chunk，也可 `read()`](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/io_streams.py#L451-L529)。 | `exec({ stream: true, onOutput })` 是 callback；另有 [`execStream() -> ReadableStream`](https://github.com/cloudflare/sandbox-sdk/blob/664d8e36d22f2b8f286a9cac90551113afdb316c/packages/sandbox/src/sandbox.ts#L4225-L4288)。 |
| 8. 后台/长生命周期进程 + stdin 双向 | [`commands.run(cmd, { background: true, stdin: true }) -> CommandHandle`](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/commands/index.ts#L374-L480)，handle 可 [`sendStdin`/`closeStdin`/`wait`/`kill`](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/commands/commandHandle.ts#L160-L247)，并可按 PID connect。 | session：`createSession -> executeSessionCommand({ runAsync: true }) -> sendSessionCommandInput`，日志 callback；PTY：`createPty`/`connectPty(id)` 的 handle 有 `sendInput/wait/disconnect`，可重连。 [Process](https://www.daytona.io/docs/process-code-execution/) [PTY](https://www.daytona.io/docs/pty/) | 同一 `exec` 立即返回 `ContainerProcess`，可 [`poll/wait`](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/container_process.py#L60-L109)；stdin `write/drain/write_eof`，与 stdout/stderr 三路流构成双向。[stdin](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/io_streams.py#L699-L765) | [`startProcess` 返回可 kill/status/log/wait 的 Process](https://github.com/cloudflare/sandbox-sdk/blob/664d8e36d22f2b8f286a9cac90551113afdb316c/packages/shared/src/types.ts#L223-L377)，但无 stdin。双向要走 [`terminal(request)` WebSocket PTY](https://github.com/cloudflare/sandbox-sdk/blob/664d8e36d22f2b8f286a9cac90551113afdb316c/packages/sandbox-container/src/handlers/pty-ws-handler.ts#L67-L95)。 |
| 9. 暂停/恢复：有没有，状态保留到什么程度 | [`pause({ keepMemory? })`](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/index.ts#L639-L660)：默认 full-memory snapshot；`keepMemory: false` 只保留 filesystem，connect 时冷启动并丢失进程/连接。[lifecycle 约束](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/sandboxApi.ts#L414-L473) | 官方页将 pause/resume、memory snapshot 标为 **VM sandbox** feature；当前公开文档未给进程/内存/filesystem 保存程度或稳定方法签名，容器不可据此推断。[Sandboxes](https://www.daytona.io/docs/sandboxes/) | 未查到 `pause/resume`。实验性 `_experimental_snapshot()` 保存 filesystem 与 memory，`_experimental_from_snapshot()` 建立**新** sandbox，不是原 handle suspend/resume。[snapshot](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/snapshot.py#L17-L24) [restore](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/sandbox.py#L2215-L2311) | 未查到 `pause/resume`。[`sleepAfter` idle sleep 与 `keepAlive`](https://github.com/cloudflare/sandbox-sdk/blob/664d8e36d22f2b8f286a9cac90551113afdb316c/packages/shared/src/types.ts#L458-L490) 是生命周期控制；源码说明 sleep/eviction 后 container filesystem 会丢失，故无状态保留式 resume 保证。[说明](https://github.com/cloudflare/sandbox-sdk/blob/664d8e36d22f2b8f286a9cac90551113afdb316c/packages/sandbox/src/sandbox.ts#L1068-L1073) |
| 10. 超时模型 | sandbox 生命周期可在 create 时设 timeout 和 `onTimeout: pause/kill`；命令有独立 `timeoutMs`，连接/文件请求还有 `requestTimeoutMs`。[lifecycle](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/sandboxApi.ts#L414-L473) [command](https://github.com/e2b-dev/E2B/blob/f0facc5dbcf93067326745e1597b05311c0174ea/packages/js-sdk/src/sandbox/commands/index.ts#L44-L91) | `executeCommand` 有 per-command 秒级 timeout；解释器调用默认 600 秒、0 禁用；create 另有 auto-stop/archive/delete。不是统一 deadline。[Process](https://www.daytona.io/docs/process-code-execution/) [Sandboxes](https://www.daytona.io/docs/sandboxes/) | create 的 `timeout` 是最大生命周期（默认 300s），另有 `idle_timeout`；`exec(timeout=None)` 是独立 deadline；`wait_until_ready(timeout=300)` 又是 ready 预算。[lifecycle](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/sandbox.py#L551-L646) [exec](https://github.com/modal-labs/modal-client/blob/c1f8b92d1613beaf73aecc6b55281a038f1dfaf4/py/modal/sandbox.py#L2092-L2213) | per-command `timeout`；session 有 `commandTimeoutMs`；container 启动另有 instance/port timeout，idle sleep 又单列。[command](https://github.com/cloudflare/sandbox-sdk/blob/664d8e36d22f2b8f286a9cac90551113afdb316c/packages/sandbox/src/clients/command-client.ts#L27-L57) [session](https://github.com/cloudflare/sandbox-sdk/blob/664d8e36d22f2b8f286a9cac90551113afdb316c/packages/shared/src/types.ts#L421-L452) |

## 分析

### 已收敛的核心

四家都以一个带身份的远端执行对象为中心，随后在其下提供文件与进程域。是否称作 `Sandbox`、Durable Object stub 或由顶层 client 创建，差别并不改变这个事实。对于 adapter 的最小公共面，以下能力有足够强的交集：

- 获取一个绑定环境身份的 handle；
- 读文件、覆盖写文件、列目录；
- 在可指定工作目录、环境变量和命令 deadline 的条件下执行命令；
- 获取 exit status，以及至少某种 stdout/stderr 输出渠道。

这解释了为什么现有产品都长出相似的工作空间模型，但它不能推出 API 可以直接互换。比如 Daytona 的 `upload/download` 是传输视角，E2B 是 POSIX-ish `read/write`，而 Modal 用 Python filesystem namespace；这些可被 adapter 投影成同一个调用方模型，不能反过来把其中一个命名抬为领域事实。

### 第 5 维度：链接与真实路径

这是安全语义而不是便利方法。E2B 和 Modal 都能告诉调用方某 entry 是 symlink，且返回 target 字符串；Cloudflare 至少给出 symlink type。可是它们都没有承诺“输入路径经过完整链接解析后的 canonical path”。Daytona 的公开文档连 symlink 类型字段都未形成稳定公开契约。

因此，若本项目需要 workspace boundary、防止链接逃逸或发放 path capability，不能委托给一个假想的跨厂商 `realpath`。应把 canonicalization/边界验证定义为本项目的能力要求：本地 adapter 能精确实现；云 adapter 要么在其侧通过受控命令/agent 明确实现并验证，要么声明该能力不可用。不要因为 `stat` 可见 symlink 就推断 read/write 已安全地限制在根目录内。

### 第 8 维度：长进程与双向 stdin

四家均支持长时间活动，但抽象边界完全不同。E2B 将 synchronous `run` 和 background `run` 放在同一 overload，返回可按 PID 再连接的 `CommandHandle`；Modal 从一开始就返回 process handle，以 async stdio 组成完整交互。Daytona 把 session command 和 PTY 分开；Cloudflare 也把普通 background Process 与 WebSocket terminal 分开，且前者没有 stdin。

所以一个只含 `execute(command) -> result` 的环境接口可以覆盖工具型命令，却不能作为 interactive terminal 或 daemon 的通用模型。流类型同样不可抹平：callback、async iterable、`ReadableStream` 需要由 adapter 处理 backpressure 与取消。若调用方确实需要交互，应使用单独的 `openTerminal` / `startInteractiveProcess` capability，而不是给 `execute` 加一个含糊的 `background: true`。

### 第 9 维度：暂停、恢复与状态保留

这里不能只看方法名。E2B 将同一 sandbox 的 pause 明确定义成两种 snapshot：完整 memory state，或只保留 filesystem 且恢复后丢掉进程和连接。Modal 的 snapshot 是预览能力，并恢复成新 sandbox；Daytona 在 VM 级别列出 pause/resume 与 memory snapshot，但当前公开文档没有可纳入统一契约的状态细则；Cloudflare 的 idle sleep/DO eviction 恰好反例式地说明 filesystem 都可能丢失。

因此 pause/resume 不是 `Promise<void>` 能表达的共同能力。若业务未来需要它，生命周期接口至少应返回/暴露 snapshot outcome，例如 `none`、`filesystem-only`、`memory-and-filesystem`，并明确 resume 是“原环境继续”还是“创建新环境”。否则调用方无法正确判断已有 PID、stdin channel 或内存会话是否仍有效。

### 超时的边界

各家都把 timeout 分在不同层：命令 wall-clock、网络 RPC、启动就绪、环境最大寿命、idle 回收、session 默认命令限制。把所有这些塞进 `ExecutionEnvironment.execute(..., { timeoutMs })` 会让调用方误以为它能限制环境生命周期或连接等待。合适做法是将 per-command deadline 留在 execute options，而把环境租约/idle 回收、attach/provision deadline 和 transport request deadline 分别放在环境获取/生命周期层或 adapter 内部。

## 对本项目的影响

现有 [`ExecutionEnvironment`](../../../packages/agent/src/harness/environment/types.ts) 已把调用方需要的文件、搜索与 shell 语义置于本项目接口中。以上证据支持继续以**自有接口 + 供应商 adapter**为方向，而不是采用 E2B、Daytona、Modal 或 Cloudflare 的某一家 API 作为契约。

接口应以本项目真正需要且四家都有足够映射的最小端到端能力为准：受控 workspace 中的 read/list/stat/overwrite-write，以及带 `cwd`、env、取消和 per-command deadline 的 non-interactive execute。供应商强项不应伪装成所有实现都支持的必选方法。

三个地方需要显式设计取舍，而不是预防性把所有 SDK 方法塞进基础接口：

- **canonical path / symlink safety**：若调用方要 boundary guarantee，保留为本项目语义（或独立 `PathCapabilityManager`），并让不具备可靠实现的 adapter 在获取能力时失败；不要以 vendor `stat` 的 link target 代替。
- **交互进程**：仅当产品有真实终端/REPL/daemon 管理用例时，再以可选 capability 暴露 handle、stdout/stderr、stdin、kill 与 attach；它不能从普通 `Shell.execute` 自动推出。
- **暂停与恢复**：把它作为可选 lifecycle/snapshot capability，并把状态保留等级和是否产生新 environment identity 放进结果 DTO；不要承诺所有 adapter 都有透明 resume。

换言之，共同形状足以为自定义 `ExecutionEnvironment` 的核心提供经验依据，**不足以安全地直接绑定任何一家 SDK**。最终接口应服务本项目的领域语义，再用 E2B/Daytona/Modal/Cloudflare adapter 在能力边界处诚实报告支持与限制。
