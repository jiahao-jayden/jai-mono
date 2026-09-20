# Anthropic Sandbox Runtime 本地 shell enforcement 实测

> 核验日期：2026-09-20（本机 Asia/Singapore，`date '+%Y-%m-%d %Z'` 输出 `2026-09-20 +08`）。  
> 固定 npm 包：`@anthropic-ai/sandbox-runtime@0.0.77`，npm integrity `sha512-uOe6kkAbo91r5shXXBxZ1DKbOpWmnXkNDDujXrFJRaHSG7D7s8b7Yfsu0pGDkYFgKZ2ECtVCNisl6pCYcaMF7A==`。  
> 固定官方源码：tag `v0.0.77`，commit [`6fa731368807419ee157f9a3fac955fefe1019c6`](https://github.com/anthropics/sandbox-runtime/commit/6fa731368807419ee157f9a3fac955fefe1019c6)。  
> 运行范围：一次性临时目录 `/tmp/srt-smoke.j2CNfA`；没有修改 Jai 仓库依赖或 lock，没有读取用户真实 secret，没有修改系统设置；loopback server 只监听本次 fixture 的 `127.0.0.1` 随机端口，并在每次测试后只停止本次启动的 PID。

## 结论

1. **在本机 macOS arm64 上，官方包能对子进程树施加实际的文件系统和网络 OS 边界。** synthetic secret 的读取得到 `Operation not permitted`，workspace 内写入成功，workspace 外写入得到 `Operation not permitted`；nested `sh` 和 child Node 同样受限。[官方 macOS enforcement 说明](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L1-L5)
2. **网络默认是拒绝，loopback 也不例外；显式 `allowLocalBinding: true` 后，本地 test server 可访问。** `false` 时 direct curl 返回退出码 7，child Node 返回 `EPERM`；`true` 时 curl 和 child Node 都拿到 HTTP 200。[官方网络配置](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L351-L365)
3. **文件策略是“读默认允许、按 denyRead 收紧；写默认拒绝、按 allowWrite 开洞”，并且作用于整个进程树。** 本次测试验证了该组合，不能把 `allowWrite` 误解成只保护顶层 shell。[官方文件配置](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L405-L415)
4. **配置文件本身是 fail-closed 的输入边界。** 指定 settings 缺少必需的 `filesystem.denyRead` / `denyWrite` 时，srt 在启动被拒绝，不回退到 built-in defaults；合法配置才会进入 sandbox 执行。[官方配置错误行为](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L177-L185)
5. **本次证明的是 macOS Seatbelt 路径，不是 Linux kernel enforcement；Linux 实测不能运行。** 当前主机是 Darwin arm64，`/usr/bin/sandbox-exec` 存在，`bwrap` 不存在；因此不能把本报告的结果外推为 Linux bubblewrap 可运行或跨平台等价。[官方平台边界](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L3-L5)

## 固定版本与运行环境

**发现：npm 包、官方源码 tag 和实际 CLI 均可被独立核验，但包版本与 CLI 自报版本不同。**

[固定 package.json](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/package.json#L1-L15) · [固定仓库归属](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/package.json#L72-L81)

```text
$ npm view @anthropic-ai/sandbox-runtime@0.0.77 version dist.tarball dist.integrity repository.url --json
{
  "version": "0.0.77",
  "dist.tarball": "https://registry.npmjs.org/@anthropic-ai/sandbox-runtime/-/sandbox-runtime-0.0.77.tgz",
  "dist.integrity": "sha512-uOe6kkAbo91r5shXXBxZ1DKbOpWmnXkNDDujXrFJRaHSG7D7s8b7Yfsu0pGDkYFgKZ2ECtVCNisl6pCYcaMF7A==",
  "repository.url": "git+https://github.com/anthropics/sandbox-runtime.git"
}

$ git ls-remote --tags https://github.com/anthropics/sandbox-runtime.git refs/tags/v0.0.77
6fa731368807419ee157f9a3fac955fefe1019c6  refs/tags/v0.0.77

$ node --version && npm --version
v22.23.2
10.9.8

$ uname -a
Darwin JaydendeMacBook-Air.local 27.0.0 Darwin Kernel Version 27.0.0: Tue Aug 11 21:05:41 PDT 2026; root:xnu-13432.1.9~1/RELEASE_ARM64_T8122 arm64

$ sysctl -n hw.model && sysctl -n hw.ncpu
Mac15,12
8

$ srt --version
1.0.0

$ node -p "require('@anthropic-ai/sandbox-runtime/package.json').version"
0.0.77
```

`npm` 安装只在 `/tmp/srt-smoke.j2CNfA` 完成：`npm install --prefix "$TMP" --ignore-scripts --no-audit --no-fund @anthropic-ai/sandbox-runtime@0.0.77`；Jai 仓库没有新增依赖或 lock 变更。`srt --version` 的 `1.0.0` 是 CLI 自报值，本文以 npm package version `0.0.77` 和源码 tag SHA 作为研究版本。

## Fixture 与配置

**发现：所有 fixture 和副作用都在本次临时目录内。**

[官方 CLI 用法](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L168-L185)

```text
/tmp/srt-smoke.j2CNfA/
├── secret.txt                 synthetic-secret-do-not-use
├── outside/                   外写拒绝目标
├── workspace/
│   ├── seed.txt               workspace-readable
│   ├── child-read.js
│   ├── child-write.js
│   └── child-http.js
├── settings-files.json        deny secret; allow workspace writes
├── settings-loopback-deny.json
├── settings-loopback-allow.json
├── settings-open.json         仅用于交叉污染顺序测试
└── server.js                  127.0.0.1 随机端口 HTTP fixture
```

本次主文件配置的语义是：`denyRead=[/tmp/.../secret.txt]`、`allowWrite=[/tmp/.../workspace]`、`denyWrite=[/tmp/.../outside]`、`allowedDomains=[]`。loopback deny/allow 两份配置显式包含 schema 要求的 `denyRead=[]`、`allowRead=[]`、`denyWrite=[]`，只切换 `network.allowLocalBinding`。

## 文件 enforcement

**发现：synthetic secret 被拒绝，workspace 写入允许，workspace 外写入拒绝。**

[官方读写默认策略](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L405-L415)

```text
$ srt --settings /tmp/srt-smoke.j2CNfA/settings-files.json -c "cat '/tmp/srt-smoke.j2CNfA/secret.txt'"
cat: /tmp/srt-smoke.j2CNfA/secret.txt: Operation not permitted
rc=1

$ srt --settings /tmp/srt-smoke.j2CNfA/settings-files.json -c "printf workspace-ok > '/tmp/srt-smoke.j2CNfA/workspace/direct-workspace.txt'"
rc=0 exists=yes

$ srt --settings /tmp/srt-smoke.j2CNfA/settings-files.json -c "printf outside-attempt > '/tmp/srt-smoke.j2CNfA/outside/direct-outside.txt'"
/bin/bash: /tmp/srt-smoke.j2CNfA/outside/direct-outside.txt: Operation not permitted
rc=1 exists=no
```

这不是只读 fixture 的结果：`direct-workspace.txt` 确实落在 workspace，`direct-outside.txt` 不存在。读约束使用 exact synthetic path；没有触碰 `$HOME/.ssh`、token、credential 或其他用户文件。

## Nested shell 与 child Node

**发现：nested `sh` 和 child Node 沿用同一文件边界；child Node 能读 workspace seed、不能读 secret，能写 workspace、不能写 outside。**

[官方“整个进程树”说明](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L1-L5)

```text
$ srt --settings /tmp/srt-smoke.j2CNfA/settings-files.json -c \
  "sh -c 'printf nested-ok > /tmp/srt-smoke.j2CNfA/workspace/nested-shell.txt; \
  node /tmp/srt-smoke.j2CNfA/workspace/child-read.js \
    /tmp/srt-smoke.j2CNfA/secret.txt /tmp/srt-smoke.j2CNfA/workspace/seed.txt; \
  node /tmp/srt-smoke.j2CNfA/workspace/child-write.js \
    /tmp/srt-smoke.j2CNfA/workspace /tmp/srt-smoke.j2CNfA/outside'"
{"secret":"EPERM: EPERM: operation not permitted, open '/tmp/srt-smoke.j2CNfA/secret.txt'","workspace":"workspace-readable\n"}
{"workspace":"write-ok","outside":"EPERM: EPERM: operation not permitted, open '/tmp/srt-smoke.j2CNfA/outside/child-node.txt'"}
rc=0
```

外层 shell 的 `rc=0` 只表示测试脚本最后一个 child Node 进程正常输出结果；权限失败被 fixture 脚本捕获为结构化结果。另有独立 direct shell write 测试确认拒绝时 wrapper 自身返回 `rc=1`。

## Loopback 网络 enforcement

**发现：`allowLocalBinding=false` 时 direct loopback 连接被拒绝；`true` 时同一端口被允许。**

[官方 loopback 默认与例外](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L351-L365)

```text
Host fixture: node server.js -> 127.0.0.1:59116, response body "loopback-ok\n"

$ env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
  srt --settings settings-loopback-deny.json -c \
  "curl --noproxy '*' --connect-timeout 2 -sS http://127.0.0.1:59116/"
curl: (7) Failed to connect to 127.0.0.1 port 59116 after 0 ms: Could not connect to server
rc=7

$ env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
  srt --settings settings-loopback-allow.json -c \
  "curl --noproxy '*' --connect-timeout 2 -sS http://127.0.0.1:59116/"
loopback-ok
rc=0
```

端口是每次 server 启动时随机分配；这里的数字只属于该次 smoke，不是固定产品配置。server PID `34623` 由本次命令启动并在测试后停止。

## Nested shell 与 child Node 的网络结果

**发现：网络限制也穿过 nested shell 传给 child Node；允许开关改变的是同一条子进程树。**

[官方网络代理/OS 边界](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L107-L128)

```text
Host fixture: node server.js -> 127.0.0.1:59192

$ srt --settings settings-loopback-deny.json -c \
  "sh -c 'node workspace/child-http.js http://127.0.0.1:59192/'"
{"error":"EPERM"}
rc=1

$ srt --settings settings-loopback-allow.json -c \
  "sh -c 'node workspace/child-http.js http://127.0.0.1:59192/'"
{"status":200,"body":"loopback-ok\n"}
rc=0
```

这次 child Node 使用 `node:http`，不是继承 shell 的 curl 输出；因此可以确认限制不只作用于一个命令行客户端。

## 配置错误与失败边界

**发现：不完整的指定配置不会静默变成宽松默认。**

[官方 settings fail-closed 规则](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L177-L185)

```text
$ srt --settings settings-loopback-deny.json -c "curl ..."
Error: /tmp/srt-smoke.j2CNfA/settings-loopback-deny.json does not hold a valid config — filesystem.denyRead: Required; filesystem.denyWrite: Required
Refusing to run with the built-in defaults, which would drop this file's rules (its denyRead, allowRead and credential entries included).
rc=1
```

该失败发生在第一次 loopback 尝试，随后补齐必需空数组并重跑。它不能被解释成网络拒绝；它是 settings schema/启动边界拒绝。

**发现：跨进程的 CLI 配置顺序没有观察到交叉污染，但这不等于已经证明 library singleton 安全。**

[官方 CLI settings 入口](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L168-L185)

```text
$ srt --settings settings-files.json -c "cat secret.txt"
deny1_rc=1 output=cat: .../secret.txt: Operation not permitted
$ srt --settings settings-open.json -c "cat secret.txt"
open_rc=0 output=synthetic-secret-do-not-use
$ srt --settings settings-files.json -c "cat secret.txt"
deny2_rc=1 output=cat: .../secret.txt: Operation not permitted
```

这是三个独立 CLI 进程的顺序证据：deny -> open -> deny 没有把 open 配置泄漏到第三次。`SandboxManager.initialize()` 在同一 Node 进程中的多次初始化、`wrapWithSandbox` 的配置作用域和全局 proxy/sandbox 状态没有在本次真跑中单独验证，见待验证。

## Trace：一次文件请求

1. 启动命令读取 `settings-files.json`；配置中存在 `denyRead`、`allowRead`、`allowWrite`、`denyWrite` 和 network lists，进入合法配置路径。
2. `srt` 为 macOS 生成 Seatbelt sandbox，并把 shell 作为受限根进程启动；官方文档明确 macOS 使用 `sandbox-exec`。
3. 外层 shell 执行 `sh -c`；`sh` 是受限进程树中的子进程，不会离开 Seatbelt。
4. child Node 调用 `fs.readFileSync(secret)`；内核返回 `EPERM`，fixture 将其打印为 `{"secret":"EPERM..."}`。
5. child Node 调用 `fs.writeFileSync(workspace/child-node.txt)`；该路径命中 `allowWrite`，返回 `write-ok`。
6. child Node 调用 `fs.writeFileSync(outside/child-node.txt)`；该路径不在 write allow 中且命中 `denyWrite`，返回 `EPERM`。
7. wrapper 退出后，只清理由本次测试启动的 server PID；fixture、settings 和 npm 安装目录仍全部位于 `/tmp/srt-smoke.j2CNfA`，未写入产品仓库。

## 不能运行与待验证

[官方平台边界](https://github.com/anthropics/sandbox-runtime/blob/6fa731368807419ee157f9a3fac955fefe1019c6/README.md#L3-L5)

```text
本机：Darwin arm64；/usr/bin/sandbox-exec 存在；bwrap 不存在。
结论：本次只证明 macOS Seatbelt 路径，不能宣称 Linux bubblewrap 已运行。
```

- **Linux kernel enforcement 未实测。** 本机是 macOS arm64；`/usr/bin/sandbox-exec` 存在，`bwrap` 不存在，不能在本机声称 Linux bubblewrap 路径可行。
- **未验证 Windows WFP。** 当前主机不是 Windows，不安装 `srt-sandbox` 用户、不改 WFP 或系统账户。
- **未做 library singleton 的同进程交叉污染测试。** 本次只跑了独立 CLI 进程的 deny -> open -> deny 顺序；需要 library agent/source note 确认 `SandboxManager` 的初始化/reset/代理生命周期是否全局单例、是否允许并发配置隔离。
- **未把 loopback allow 解释成通用网络 allow。** 本次只验证 `allowLocalBinding` 对 `127.0.0.1` 的直接连接；没有访问公网或用户网络资源，未测试 allowed domain 经 HTTP/SOCKS proxy 的行为。
- **未做 bypass/escape 审计。** 没有尝试 `open`、Apple Events、系统设置、真实 credential、host network interface 或其他越界手段；本任务是可行性 smoke，不是安全评估或红队测试。
- **未验证动态 `--control-fd` 更新。** 官方文档说明运行中只动态改变 network lists，而 filesystem rules 在 wrap 时编译；本次没有建立控制 FD，因为用户要求优先完成最小本地 enforcement 证据。
- **CLI 自报版本与 npm 包版本不同。** `srt --version=1.0.0`、package.json `version=0.0.77`；本报告固定的是可安装包 `0.0.77` 和源码 tag SHA，不推断两者版本语义完全相同。

## 来源覆盖

| 来源类别 | 查到了什么 |
| --- | --- |
| 官方文档 / 源码 | 已查官方 npm metadata、固定 npm 包、官方 README 和 `v0.0.77` tag `6fa731368807419ee157f9a3fac955fefe1019c6`；本地运行验证 macOS Seatbelt 的文件/网络结果。 |
| 作者或维护者本人的说法 | 官方 README 明确称其为 Anthropic Sandbox Runtime、Claude Code 的 research preview，并说明 macOS 使用 `sandbox-exec`、Linux 使用 `bubblewrap`。 |
| 同类方案 | 不适用：本任务明确只负责官方 sandbox-runtime 真跑，另一 agent 负责 library 源码笔记；没有把其他 sandbox 项目混入本次实测。 |
| issue / PR / 社区实践 | 未纳入实测结论；本次目标是本地可行性，不依赖 issue/PR 解释运行结果。 |
| 历史演变 | 未纳入实测结论；固定版本与官方 README 已足以回答本轮 macOS 文件/网络 enforcement 问题。 |

## 对本项目的影响

本次实测支持 Jai RFC 采用“每次执行包裹整个子进程树”的方向：macOS 上可用 Seatbelt 实际限制文件和网络，workspace write 需要显式 allow，loopback 也应显式决定是否开放。RFC 不应把这份 macOS smoke 当作 Linux/Windows 已验证，也不应把独立 CLI 进程无交叉污染当作 library 多实例并发安全；后两项需要另一 agent 的源码证据或对应平台实测补齐。
