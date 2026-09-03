# E2B Sandbox SDK：commands、process、PTY 与流式传输

核验日期：2026-08-26。

本笔记只覆盖 commands、process、PTY 和它们的流式传输；不讨论文件 API、sandbox 生命周期或其他厂商。

已固定的 SDK 源码是 E2B tag `e2b@2.46.0` 的 commit
[`d42686d982f741b01f2c71da304e63846b34706f`](https://github.com/e2b-dev/E2B/tree/d42686d982f741b01f2c71da304e63846b34706f)。
`infra` 的公开 tag `envd-v0.6.13` 可定位到 `2acf2d51bd1e2fe146914f24c44f7ee07d2213c5`，但本机在 HTTPS clone、无代理 clone、codeload archive、GitHub API/raw 与浏览器继续读取 Go 文件时分别遇到 `SSL_ERROR_SYSCALL`、DNS/代理失败或 `ERR_CONNECTION_CLOSED`。浏览器只读到了目录树，未读到 `packages/envd/internal/services/process/` 的 Go 文件正文。因此，下文绝不把 daemon 行为写成已确认；这是本次结论最重要的限制。

## 结论

1. **`commands.run()` 的 `timeoutMs` 在 JS SDK 中只作为 `Process.Start` server-streaming RPC 的客户端 deadline 参数传入；SDK 超时路径没有调用 `SendSignal(SIGKILL)`。所以“timeout 到期必定杀进程”无法从 SDK 源码成立，且必须由 envd 的 stream-cancellation 实现最终判定。** 状态：**从相邻代码逻辑推断**（SDK 明确仅传 `timeoutMs`，显式 kill 只在独立 `kill()` 中发送 `SIGKILL`；envd Go 源码未能读取）。([`packages/js-sdk/src/sandbox/commands/index.ts#L281-L310`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L281-L310)、[`#L439-L485`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L439-L485))
2. **Python v2.46.0 对 `timeout=0` 的实现是把 RPC 的 `timeout_ms` 设为 `None`，即取消 Connect RPC 的 call deadline；它取消的是“流连接期限”，不是向进程发送无限执行权或 kill 信号。JS 对 `timeoutMs: 0` 只是原样交给 `@connectrpc/connect` v2.1.2，因该依赖源码不在 clone 中，JS 的零值语义未能独立钉死。** 状态：Python **已在源码中确认**；JS **从相邻代码逻辑推断**。([`packages/python-sdk/e2b/envd/utils.py#L15-L24`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/envd/utils.py#L15-L24)、[`sandbox_sync/commands/command.py#L296-L315`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/sandbox_sync/commands/command.py#L296-L315)、[`packages/js-sdk/src/sandbox/commands/index.ts#L447-L464`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L447-L464)、[`packages/js-sdk/package.json#L94-L105`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/package.json#L94-L105))
3. **`disconnect()` 在两套 SDK 都只关闭/取消输出 stream：JS 调 `AbortController.abort()`；Python sync 调 generator `close()`、async 调 `aclose()`，后两者的源码明确说明会 reset HTTP/2 stream。它们都不调用进程的 `SendSignal`。但这仍不能证明 envd 收到取消后绝不会结束子进程。** 状态：SDK 半边 **已在源码中确认**；daemon 后果 **完全查不到**。([`packages/js-sdk/src/sandbox/commands/commandHandle.ts#L184-L198`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/commandHandle.ts#L184-L198)、[`packages/js-sdk/src/connectionConfig.ts#L183-L192`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/connectionConfig.ts#L183-L192)、[`packages/python-sdk/e2b/envd/client_sync/__init__.py#L89-L93`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/envd/client_sync/__init__.py#L89-L93)、[`client_async/__init__.py#L94-L98`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/envd/client_async/__init__.py#L94-L98))
4. **没有读到能够确认输出 ring buffer、落盘保存或 reconnect replay 的 envd 实现；而 `ConnectRequest` 只有 pid/tag selector，没有 cursor、offset、sequence 或 resume token。故不能声称断连输出会补发；也不能仅凭 proto 排除“服务端每次全量重放”。** 状态：buffer/replay **完全查不到**；“没有增量恢复协议字段” **已在源码中确认**。([`spec/envd/process/process.proto#L162-L170`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/spec/envd/process/process.proto#L162-L170))
5. **`CommandResult.stdout/stderr` 是每个本地 `CommandHandle` 对其自身收到的 `DataEvent` 增量拼接的结果；重连后的 `wait()` 是否全量，完全取决于 envd 在新 `Connect` stream 中是否重放旧 `DataEvent`，SDK 本身没有补偿层。** 状态：前半 **已在源码中确认**；重连全量性 **完全查不到**。([`packages/js-sdk/src/sandbox/commands/commandHandle.ts#L270-L341`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/commandHandle.ts#L270-L341)、[`packages/python-sdk/e2b/sandbox_sync/commands/command_handle.py#L90-L149`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/sandbox_sync/commands/command_handle.py#L90-L149))
6. **当前 JS SDK 已有 `stdin?: boolean`，且默认显式把 `false` 放入 `StartRequest.stdin`；最新 Python 同样默认 false。`sendStdin`/`send_stdin` 不做“此 handle 是否 stdin:true”的客户端预检，而是直接发送 `ProcessInput.stdin` unary RPC。因此调用方必须以 `stdin: true`/`stdin=True` 启动；未设置后 server 会报错、静默丢弃还是仍可写，因 envd Go 源码不可读，无法下定论。用户点名的 Python v1.0.4 本次未能取得源码包，不能把“该版没有参数”列为已确认事实。** 状态：当前启动参数与无本地预检 **已在源码中确认**；v1.0.4 与未设置时 server 行为 **完全查不到**。([`packages/js-sdk/src/sandbox/commands/index.ts#L73-L90`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L73-L90)、[`#L199-L233`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L199-L233)、[`#L426-L456`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L426-L456)、[`packages/python-sdk/e2b/sandbox_sync/commands/command.py#L244-L315`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/sandbox_sync/commands/command.py#L244-L315))
7. **协议层是 Connect RPC over fetch/HTTP，不是 SSE 或 WebSocket：JS 以 `createConnectTransport()` 建 client，生成 stub 把 `Start`/`Connect` 标为 server-streaming；Node fetch dispatcher 开启 HTTP/2。stdin 目前由每次 `SendInput` unary RPC 发送，尽管 proto 还定义了一个未被 commands facade 调用的 client-streaming `StreamInput`。** 状态：**已在源码中确认**（Node 为 HTTP/2；其他运行时实际 HTTP 版本由其 fetch 实现协商）。([`packages/js-sdk/src/sandbox/index.ts#L1-L13`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/index.ts#L1-L13)、[`#L161-L228`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/index.ts#L161-L228)、[`packages/js-sdk/src/envd/process/process_connect.ts#L29-L109`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/envd/process/process_connect.ts#L29-L109)、[`packages/js-sdk/src/undici.ts#L89-L133`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/undici.ts#L89-L133)、[`spec/envd/process/process.proto#L5-L20`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/spec/envd/process/process.proto#L5-L20))
8. **JS 的 `run(cmd, { background: true })` 是 background API 形态而非单独 `background()` 方法；前台返回 `Promise<CommandResult>`，后台返回 `Promise<CommandHandle>`。`list()` 返回 `{pid, tag?, cmd, args, envs, cwd?}[]`；`kill()` 返回 `Promise<boolean>`，仅 NotFound 时为 false。** 状态：**已在源码中确认**。([`packages/js-sdk/src/sandbox/commands/index.ts#L103-L130`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L103-L130)、[`#L167-L190`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L167-L190)、[`#L281-L310`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L281-L310)、[`#L382-L424`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L382-L424))
9. **PTY 复用同一个 `Process` service，但请求带 `pty.size`，输出走 `DataEvent.pty`，输入走 `ProcessInput.pty`；JS `Pty.sendInput` 只收 `Uint8Array`，而 command `sendStdin` 额外接受 string 并 UTF-8 编码。这是 API 层防止把终端原始字节误当文本的差异，不是两条不同网络通道。** 状态：**已在源码中确认**。([`packages/js-sdk/src/sandbox/commands/pty.ts#L106-L159`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/pty.ts#L106-L159)、[`#L230-L261`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/pty.ts#L230-L261)、[`packages/js-sdk/src/sandbox/commands/index.ts#L199-L222`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L199-L222)、[`spec/envd/process/process.proto#L69-L120`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/spec/envd/process/process.proto#L69-L120))
10. **本次固定 tag 中 commands/PTY 没有 `beta`、experimental 或 roadmap 标记；它们以稳定 tag `e2b@2.46.0` 发布。唯一相关 TODO 是 JS 对空事件的处理，而非该 API 尚未实现。不能据此推断云端 service 的稳定性承诺。** 状态：**已在源码中确认**（仅限源码中的发布/标记分类）。([`packages/js-sdk/src/sandbox/commands/commandHandle.ts#L304-L324`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/commandHandle.ts#L304-L324)、[`packages/js-sdk/src/sandbox/commands/pty.ts#L79-L106`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/pty.ts#L79-L106))

## 一、timeout 到期后进程是否被 kill

### 已读到的调用链

JS 的普通 command 启动路径等价于：

```ts
events = rpc.start(StartRequest{ process: bash -l -c cmd, stdin }, {
  signal: requestHandshakeController.signal,
  timeoutMs: opts.timeoutMs ?? 60_000,
})
pid = await first(StartEvent)
clearStartTimeout()
return CommandHandle(events, () => kill(pid))
```

其中 `requestTimeoutMs` 对应的 controller timer 在收到首个 `StartEvent` 后被清掉；`timeoutMs` 则传给 server-streaming 调用。显式 kill 只有另一路 `rpc.sendSignal({ signal: SIGKILL })`。SDK 没有把 timeout callback 接到 `kill(pid)`。

证据：[`commands/index.ts#L281-L310`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L281-L310)、[`commands/index.ts#L439-L485`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L439-L485)、[`connectionConfig.ts#L126-L192`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/connectionConfig.ts#L126-L192)。

Python 将正 timeout 转成 `timeout_ms`；`0` 与 `None` 转为 `None`，并直接交给 generated Connect client。async 版另用 `first_event()` 为首个事件施加 `request_timeout`，首个事件以后该 timer 不再约束流。

```py
def timeout_to_ms(timeout):
    if not timeout:
        return None
    return max(1, round(timeout * 1000))

events = rpc.start(..., timeout_ms=timeout_to_ms(timeout))
start_event = await first_event(events, request_timeout)
```

证据：[`envd/utils.py#L15-L24`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/envd/utils.py#L15-L24)、[`sandbox_async/commands/command.py#L284-L343`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/sandbox_async/commands/command.py#L284-L343)、[`envd/client_async/__init__.py#L109-L143`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/envd/client_async/__init__.py#L109-L143)。

### 结论

**不能从已读源码确认 timeout 到期后的进程被 kill 或继续运行。** 可以确认的是：SDK 的 timeout/abort 结束的是 Connect HTTP stream；SDK 不发送进程信号。要将其升级为“继续运行”的结论，必须检查 envd 的 `Start`/`Connect` handler 是否把 request context cancellation 传给 `exec.Cmd`、是否存在 subscriber cleanup kill，或实测 `timeout` 后 `list(pid)`。这些 daemon 代码本次不可获得。

**`timeoutMs: 0` 的精确定义：** Python 已确认禁用 RPC 的 per-call deadline；它不修改 `StartRequest`、不调用 `SendSignal`。JS 已确认把 0 传进 Connect v2.1.2；由于该依赖实现未在 clone 中，不能仅凭 SDK 的错误字符串把“0 无限 stream”写成已确认。与之分开的 `requestTimeoutMs: 0` 在 JS 本地代码中已确认会禁用“等到首个 `StartEvent`”的握手 timer。([`connectionConfig.ts#L109-L123`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/connectionConfig.ts#L109-L123)、[`#L162-L192`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/connectionConfig.ts#L162-L192))

### 置信度

- SDK 不主动 kill：**已确认**。
- Python `timeout=0` 取消 RPC deadline：**已确认**。
- JS `timeoutMs=0` 取消 Connect deadline：**推断**，待读 `@connectrpc/connect@2.1.2` 源码。
- envd 在 deadline/cancel 后是否 kill 子进程：**完全查不到**，待读 `infra` 的 process service。

## 二、断连期间输出是否被缓冲并可 replay

### 已读到的协议和 SDK 状态

proto 对输出的模型只有流上的 `StartEvent`、`DataEvent(stdout|stderr|pty)`、`EndEvent`、`KeepAlive`。新连接只提交 `ProcessSelector(pid|tag)`：没有 output offset、ack、event id 或 resume token。

```proto
rpc Connect(ConnectRequest) returns (stream ConnectResponse);

message ConnectRequest { ProcessSelector process = 1; }
message DataEvent { oneof output { bytes stdout = 1; bytes stderr = 2; bytes pty = 3; } }
```

证据：[`process.proto#L5-L20`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/spec/envd/process/process.proto#L5-L20)、[`#L69-L105`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/spec/envd/process/process.proto#L69-L105)、[`#L162-L170`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/spec/envd/process/process.proto#L162-L170)。

JS handle 每收到一段 DataEvent 才把它 decode 并 append 到 `_stdout`/`_stderr`；只有收到 EndEvent 才把当前 accumulator 封装成 `CommandResult`。流在 EndEvent 前关闭时只 flush 本地 decoder，不能凭空补字节。Python sync 的 generator 逻辑相同。

```ts
case 'stdout': this._stdout += decode(chunk)
case 'stderr': this._stderr += decode(chunk)
case 'end': this.result = { stdout: this.stdout, stderr: this.stderr, ... }
```

证据：[`commandHandle.ts#L270-L341`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/commandHandle.ts#L270-L341)、[`command_handle.py#L90-L149`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/sandbox_sync/commands/command_handle.py#L90-L149)。

断开时 JS 调 cleanup 后 abort fetch；Python 关闭 generated stream，后者源码明确说明是 HTTP/2 reset。此操作没有向新 handle 转移旧 accumulator，也没有在 SDK 端保存重放队列。

证据：[`commandHandle.ts#L184-L198`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/commandHandle.ts#L184-L198)、[`connectionConfig.ts#L183-L192`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/connectionConfig.ts#L183-L192)、[`client_sync/__init__.py#L89-L93`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/envd/client_sync/__init__.py#L89-L93)。

### 结论

**server 是否有 ring buffer/output 持久化、是否在 Connect 后重放，都无法确认。** proto 的无 cursor 设计确认了它不存在“从已确认 offset 恢复”的协议；但它仍允许服务端为每个 reconnect 发送全量历史，或仅 fan-out 新数据。两者需要 envd Go handler/进程数据结构才能区分。

**因此 reconnect 后 `wait().stdout` 不是一个可保证全量的 API 属性。** 它等于“这个新 handle 从其 stream 收到的所有 stdout”。若 envd replay，可能全量或重复；若 envd 纯 pass-through，则只会是重连后的部分。已读源码不能选择其中一个。

### 置信度

- SDK 仅累积本 handle 实际收到的事件：**已确认**。
- 无增量 resume cursor：**已确认**。
- envd ring buffer、output persistence、replay：**完全查不到**。
- `wait()` 在 reconnect 后是否全量：**完全查不到**，取决于上一项。

## 三、sendStdin 是否要求进程以特定参数启动

### 源码证据

当前 JS `CommandStartOpts` 有 `stdin?: boolean`。`start()` 把 `opts?.stdin || false` 作为 `StartRequest.stdin`，也就是说新 envd 下未设置就是显式 false。Python sync/async 也先把 `stdin = stdin or False`，再放入同一字段。proto 将该字段定义为 optional，注释说明旧兼容行为是“未给时 true”，而新 SDK 明确写 false。版本门槛是 envd `0.3.0`：旧 envd 不支持把它设为 false，SDK 因而报错。

```ts
rpc.start({ process: ..., stdin: opts?.stdin || false }, ...)

// sendStdin: no `stdin` check
rpc.sendInput({ input: { input: { case: 'stdin', value: payload } } })
```

证据：[`commands/index.ts#L40-L90`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L40-L90)、[`#L199-L233`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L199-L233)、[`#L426-L456`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L426-L456)、[`envd/versions.ts#L1-L5`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/envd/versions.ts#L1-L5)、[`process.proto#L52-L59`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/spec/envd/process/process.proto#L52-L59)、[`sandbox_sync/commands/command.py#L244-L315`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/sandbox_sync/commands/command.py#L244-L315))。

`CommandHandle.sendStdin()` 仅检查 handle 是否配了 sender callback；commands 的 `start()` 和 `connect()` 都会配这个 callback，和当初的 stdin flag 无关。因此它不会在本地拒绝一个以 `stdin:false` 启动的 pid。Python handle 也只检查 sender callback，不检查启动参数。

证据：[`commandHandle.ts#L210-L229`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/commandHandle.ts#L210-L229)、[`commands/index.ts#L471-L481`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L471-L481)、[`command_handle.py#L218-L235`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/sandbox_sync/commands/command_handle.py#L218-L235)。

### 结论

**调用方应当以 `stdin: true` / `stdin=True` 启动需要双向 stdio 的 command。** 这是当前新 SDK 实际发送的 StartRequest 字段，而不是只存在于说明文字的建议。

**没有设置时，SDK 不会静默在本地失败，也不会自动替你打开 stdin；它发出一条正常的 `SendInput` RPC。daemon 对“没有 stdin pipe 的进程”返回错误、忽略还是意外写入，当前无法从已读源码判断。** 此处不能声称任何一种结果。

**Python v1.0.4 对照：完全查不到。** 本次先查本机 cache、再按 Git tag `v1.0.4` 拉取、再从 PyPI 下载 `e2b==1.0.4`；前两步分别没有缓存/远端无该 tag，后一步分别被失效代理和 DNS 阻断。因而本笔记不把“v1.0.4 没有 stdin 参数”作为源码结论，也不从其 docstring 反推 server 行为。

### 置信度

- JS/Python 有 stdin 参数且新版本默认 false：**已确认**。
- `sendStdin` 不做本地 stdin-flag 校验：**已确认**。
- Python v1.0.4 是否有 stdin 参数：**完全查不到**。
- 未设置 `stdin` 时 daemon 的具体结果：**完全查不到**。

## 其余 API 细节

### Commands / process（JS）

| 操作 | 精确签名与返回 | 实际 RPC / 说明 |
| --- | --- | --- |
| `run` 前台 | `run(cmd: string, opts?: CommandStartOpts & { background?: false }): Promise<CommandResult>` | `Start` server stream，随后 `CommandHandle.wait()`。 |
| `run` 后台 | `run(cmd: string, opts: CommandStartOpts & { background: true }): Promise<CommandHandle>` | 没有单独 `background()`；用同一个 `Start` server stream。 |
| `connect` | `connect(pid: number, opts?: CommandConnectOpts): Promise<CommandHandle>` | `Connect` server stream，首个 event 必须是 StartEvent。 |
| `list` | `list(opts?: CommandRequestOpts): Promise<ProcessInfo[]>` | unary `List`。 |
| `kill` | `kill(pid: number, opts?: CommandRequestOpts): Promise<boolean>` | unary `SendSignal(SIGKILL)`；NotFound 变为 false。 |
| `sendStdin` | `sendStdin(pid: number, data: string \| Uint8Array, opts?): Promise<void>` | string 在 JS 先用 `TextEncoder` 转 UTF-8，再 unary `SendInput(stdin)`。 |
| `closeStdin` | `closeStdin(pid: number, opts?): Promise<void>` | unary `CloseStdin`，envd 版本须至少 0.5.2。 |

证据：[`commands/index.ts#L40-L100`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L40-L100)、[`#L167-L371`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L167-L371)、[`#L382-L485`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L382-L485)。

`ProcessInfo` 字段为 `pid: number`、`tag?: string`、`cmd: string`、`args: string[]`、`envs: Record<string, string>`、`cwd?: string`。它刻意包含 command 与环境变量，调用方若要跨进程投影，不能直接把这对象视为安全 DTO。证据：[`commands/index.ts#L103-L130`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L103-L130)。

Python 名称使用 snake_case，语义对应：`run(..., background=True)` 返回 `CommandHandle`/`AsyncCommandHandle`，否则 `CommandResult`；`list()`、`kill()`、`connect()`、`send_stdin()` 分别包住同一个 Process RPC。证据：[`sandbox_sync/commands/command.py#L55-L149`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/sandbox_sync/commands/command.py#L55-L149)、[`#L244-L390`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/sandbox_sync/commands/command.py#L244-L390)。

### 输出回调与 iterable

JS 的 callback 形式不是另一条推送通道。`CommandHandle` 构造时立刻异步遍历 Connect client 提供的 `AsyncIterable`，把 chunk 累积后依次 await `onStdout`/`onStderr`/`onPty`；对使用者没有公开 `CommandHandle[Symbol.asyncIterator]()`。Python sync handle 则自身实现 `__iter__()`，产出 `(stdout, stderr, pty)` 三元组；Python async handle 在构造时创建 task 来消费 async generator 并调 callback，同样不是公开的 async iterator。

证据：[`commandHandle.ts#L109-L127`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/commandHandle.ts#L109-L127)、[`#L344-L374`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/commandHandle.ts#L344-L374)、[`sandbox_sync/commands/command_handle.py#L62-L68`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/sandbox_sync/commands/command_handle.py#L62-L68)、[`sandbox_async/commands/command_handle.py#L81-L119`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/sandbox_async/commands/command_handle.py#L81-L119)。

### PTY（JS）

| 操作 | 签名与返回 | 关键行为 |
| --- | --- | --- |
| `create` | `create(opts: PtyCreateOpts): Promise<CommandHandle>` | 必填 `cols`、`rows`、`onData`；启动 `/bin/bash -i -l`，带 `pty.size`。 |
| `connect` | `connect(pid: number, opts?: PtyConnectOpts): Promise<CommandHandle>` | 对已有 PTY 建 server stream；`onData` 可选。 |
| `sendInput` | `sendInput(pid: number, data: Uint8Array, opts?): Promise<void>` | unary `SendInput(pty)`。 |
| `resize` | `resize(pid, { cols, rows }, opts?): Promise<void>` | unary `Update(pty.size)`。 |
| `kill` | `kill(pid, opts?): Promise<boolean>` | unary `SendSignal(SIGKILL)`。 |

PTY 和 commands 共用 pid namespace、`list()` 和 `Process` service；PTY 是 pseudo-terminal，故读写都保持 bytes。普通 command 的 stdin 可被 SDK 方便地接受为 text，但其在线上仍是 proto `bytes stdin`。如果需要 EOF，普通 command 有 `closeStdin`；PTY 没有对应 RPC，proto 注释明确要求把 `0x04` 作为 PTY bytes 输入。

证据：[`pty.ts#L33-L77`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/pty.ts#L33-L77)、[`#L106-L220`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/pty.ts#L106-L220)、[`#L230-L346`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/pty.ts#L230-L346)、[`process.proto#L13-L20`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/spec/envd/process/process.proto#L13-L20)、[`#L107-L120`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/spec/envd/process/process.proto#L107-L120)。

### 传输层及可靠性边界

```text
Host SDK
  Start / Connect: Connect server-streaming RPC  ---> ProcessEvent stream
  SendInput / SendSignal / Update / CloseStdin: unary Connect RPC ---> envd
  StreamInput: proto 有 client-streaming RPC，但当前 high-level commands 未使用
```

- JS 选择 `createConnectTransport`，`useBinaryFormat: false`，因此是 Connect HTTP framing 的 JSON 编码，不是 gRPC-web、SSE 或 WebSocket。([`sandbox/index.ts#L168-L200`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/index.ts#L168-L200)、[`process_connect.ts#L42-L58`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/envd/process/process_connect.ts#L42-L58))
- Node 的 envd fetch dispatcher 是 `undici.Agent({ allowH2: true })`；Python client 的源码也说明其 shared pool 使用单条 HTTP/2 connection，并且 close/aclose early stream 会 reset HTTP/2 stream。不能把这一点泛化为浏览器环境一定用 H2。([`undici.ts#L89-L133`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/undici.ts#L89-L133)、[`client_sync/__init__.py#L61-L85`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/envd/client_sync/__init__.py#L61-L85))
- stream 的客户端可靠性边界是“HTTP stream 未 reset 且 callback/iterator 持续读取”。已读 API 没有 ack、sequence、resume cursor 或 SDK-side spool；server 是否额外实现了 replay 是未解问题，不能把 Connect/H2 本身当作保证。([`process.proto#L69-L105`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/spec/envd/process/process.proto#L69-L105)、[`#L162-L170`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/spec/envd/process/process.proto#L162-L170))

## 对本项目的影响

**判断：以“Host 可在任意暂时断连后可靠地和沙箱内 MCP stdio server 双向通信”为验收标准，当前路线不可行，应该退回到只支持 HTTP/SSE transport 的 MCP。** 这不是断言 E2B 一定没有能力，而是证据不足以允许把 commands stream 当可靠会话通道：daemon 是否保活进程、是否缓存 stdout/stderr、reconnect 是否 replay，三个决定性事实都没有从 envd 源码得到确认；proto 也没有可由 Host 驱动的 offset/ack recovery。一次 Host 网络抖动即可让 stdio 协议丢失 JSON-RPC frame、重复 frame 或错过 EndEvent，而 SDK 无法修复。

一个**受限 PoC**在技术上仍可尝试：`commands.run(server, { background: true, stdin: true, timeoutMs: 0 })` 后持续保持同一 Connect stream，并以 `sendStdin` 写入。它必须把 stream reset 视为 fatal，不允许透明 reconnect；Python 的 `timeout=0` 已证实只取消 RPC deadline，JS 的零值语义和 envd cancel 后的进程存活仍须先补源码证据。([`commands/index.ts#L382-L485`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/index.ts#L382-L485)、[`commandHandle.ts#L184-L198`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/js-sdk/src/sandbox/commands/commandHandle.ts#L184-L198)、[`envd/utils.py#L15-L24`](https://github.com/e2b-dev/E2B/blob/d42686d982f741b01f2c71da304e63846b34706f/packages/python-sdk/e2b/envd/utils.py#L15-L24))

在决定改变这个“不可靠”的结论前，唯一足够的补证是固定一个实际 envd commit，审阅其 `Start`、`Connect`、process registry 和 stdout/stderr fan-out 的 Go 实现；或在同一固定 envd 镜像上做 source-backed integration probe：启动带单调编号输出的长命令，断流、重连、`wait()`，并同时检查 pid 是否仍在 `list()`。本笔记按要求未执行该测试。
