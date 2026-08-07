# Agent Plugins 官方示例与 PandaWork Conformance 基线

调研日期：2026-08-07

## 结论

官方 [`agentplugins/agent-plugins-example`](https://github.com/agentplugins/agent-plugins-example/tree/5f3f5084a821aefa792e79500dd8f0462ab83473) 在固定 commit 上只有**一个 Skills-only 正向包**：一个合法 `plugin.json`、一个 `migrate-agent-plugin` Skill 和三个 reference 文件。它没有 `mcp.json`、可执行脚本、client-extension 实例、测试程序或故意无效的 fixture。因此，“官方仓库里的案例都可以运行”的精确验收是：PandaWork 原样导入该 commit，发现并激活唯一 Skill，且能从同一包根读取它引用的三个文件；不能把这一个通过结果等同于完整 Agent Plugins v1 conformance。[官方 README 与布局](https://github.com/agentplugins/agent-plugins-example/blob/5f3f5084a821aefa792e79500dd8f0462ab83473/README.md)；[固定仓库树](https://github.com/agentplugins/agent-plugins-example/tree/5f3f5084a821aefa792e79500dd8f0462ab83473)

完整兼容需要另建一组**由固定规范派生、由 PandaWork 维护**的 fixtures，覆盖 manifest 特例、固定位置发现、Agent Skills 校验、三种 MCP transport、`${PLUGIN_ROOT}` / `${PLUGIN_DATA}`、client extensions、路径 containment 和四层失败隔离。上游规范本身给了 JSON/text 示例和 checklist，但没有发布可运行 conformance suite；规范正文明确说 Appendix A 只是便利清单，冲突时正文优先。[v1 §11 与 Appendix A](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#11-client-conformance)

## 固定来源

本报告在调研时重新 fetch 并核对了两个官方仓库的 `origin/main`；下列 `HEAD`、`origin/main` 与 `FETCH_HEAD` 一致。测试必须固定 commit 和文件摘要，不从 `main`、官网动态页面或加载时网络 schema 获取内容。

| 材料 | 固定版本 | SHA-256 | 用途 |
| --- | --- | --- | --- |
| [Agent Plugins v1.0.0 规范](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md) | `agentplugins/agent-plugins-spec@bd383552095128f6effe895b9257cfd580a6d179` | `97a658b7dca3ce1b4c2266b95da300fa51d9dc4ade59d73168e5f9104272da18` | normative source |
| [`plugin.schema.json`](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/schemas/1.0.0/plugin.schema.json) | 同一 repository tree | `0a4aad95ce337878ad38802ebf0daa3fde76abe3f65400c86bcbb1ec0b3ab883` | manifest structural validation |
| [`mcp.schema.json`](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/schemas/1.0.0/mcp.schema.json) | 同一 repository tree | `6539175bfcdf43085855183e86da40ea94b166547a72b47ae9a0a390516d3acb` | MCP top-level 与 per-server validation |
| [官方 example](https://github.com/agentplugins/agent-plugins-example/tree/5f3f5084a821aefa792e79500dd8f0462ab83473) | `agentplugins/agent-plugins-example@5f3f5084a821aefa792e79500dd8f0462ab83473` | 下表逐文件固定 | 原样 upstream integration fixture |
| [Agent Skills 规范](https://github.com/agentskills/agentskills/blob/217be548739f21d6008915c29aefe320ea1a90af/docs/specification.mdx) 与 [`skills-ref`](https://github.com/agentskills/agentskills/tree/217be548739f21d6008915c29aefe320ea1a90af/skills-ref) | `agentskills/agentskills@217be548739f21d6008915c29aefe320ea1a90af` | 由 vendored commit 固定 | Skill format 与负向 Skill fixtures |

`agent-plugins-spec` 的 v1 正文最后一次内容修改是 published commit [`1fc1b627`](https://github.com/agentplugins/agent-plugins-spec/commit/1fc1b6270e3cc492ec2d24ad7a34277c6d53b9c1)，两份 schema 最后一次内容修改是 [`d92e6f44`](https://github.com/agentplugins/agent-plugins-spec/commit/d92e6f443b8edcea42c039727a82afdc565779e2)；这里仍固定更新后的完整 repository tree `bd383552...`，使规范、schema、许可和上下文来自同一快照。

### 官方 example 的完整文件清单

| 路径 | SHA-256 | 必须验证的行为 |
| --- | --- | --- |
| [`plugin.json`](https://github.com/agentplugins/agent-plugins-example/blob/5f3f5084a821aefa792e79500dd8f0462ab83473/plugin.json) | `febc5269ac2154f2ca38257e15e126dfb481a5f4558a35bdf126d1ce10aff885` | 识别 v1.0.0；保留全部合法 metadata |
| [`skills/migrate-agent-plugin/SKILL.md`](https://github.com/agentplugins/agent-plugins-example/blob/5f3f5084a821aefa792e79500dd8f0462ab83473/skills/migrate-agent-plugin/SKILL.md) | `cbcfa4804eaf880593f382f8e873d5c59f57dbb0762e481891c5b1ca1d1db41c` | 唯一 Skill 被发现、校验、进入 catalog 并可激活 |
| [`references/client-extensions.md`](https://github.com/agentplugins/agent-plugins-example/blob/5f3f5084a821aefa792e79500dd8f0462ab83473/skills/migrate-agent-plugin/references/client-extensions.md) | `c984d550a7ae69b13af027498138f365ff8b7fc8c52916614c808a3ee0a32a81` | Skill-relative 读取成功 |
| [`references/migration-guide.md`](https://github.com/agentplugins/agent-plugins-example/blob/5f3f5084a821aefa792e79500dd8f0462ab83473/skills/migrate-agent-plugin/references/migration-guide.md) | `e890734311a58041323594525ca1094b235bbd73f34dffe4ff14d2b51e8b0df8` | Skill-relative 读取成功 |
| [`references/validation-checklist.md`](https://github.com/agentplugins/agent-plugins-example/blob/5f3f5084a821aefa792e79500dd8f0462ab83473/skills/migrate-agent-plugin/references/validation-checklist.md) | `398ea49d9f61ea64adf927a447e15ae9c6c5f78b1af68e9ce3fcb646c5ce89b6` | Skill-relative 读取成功 |
| [`README.md`](https://github.com/agentplugins/agent-plugins-example/blob/5f3f5084a821aefa792e79500dd8f0462ab83473/README.md) | `a2a8a0f1427fe855a692b6e94236d7ab2d95925ff68ca17a0698c06c21816dfb` | 不作为 portable component |
| [`LICENSE`](https://github.com/agentplugins/agent-plugins-example/blob/5f3f5084a821aefa792e79500dd8f0462ab83473/LICENSE) | `1126322e2cc8d165adc4c792eeb195717de2bcc7b39be1ce77959d78e87ef685` | 不作为 portable component |

本次用固定 `agentskills/agentskills@217be548...` 的官方 `skills-ref validate` 实际校验了 `migrate-agent-plugin`，结果为 `Valid skill`。example 中没有 `mcp.json` 或 extension 文件；README 里的 MCP 和 `com.vendor.client` 只是作者指导片段，不是仓库内可执行组件。[example README: portable core 与 extension 片段](https://github.com/agentplugins/agent-plugins-example/blob/5f3f5084a821aefa792e79500dd8f0462ab83473/README.md#the-portable-core)

## 规范定义的包形态

PandaWork 的 fixture corpus 至少要表达以下包形态；路径与发现位置固定，不能由 manifest 重定向：[v1 §4.2、§6](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#42-standard-layout)

```text
minimal/                         full/
└── plugin.json                  ├── plugin.json
                                 ├── skills/<name>/SKILL.md
                                 ├── mcp.json
                                 └── com.example.client/...
```

- `plugin.json` 是唯一必需文件，因此 manifest-only package 合法。
- `skills/` 只发现直接子目录内、大小写准确为 `SKILL.md`、解析后为普通文件的项；不递归。
- `mcp.json` 只能位于包根；不存在、空 `mcpServers` 都合法。
- extension manifest data 位于 `plugin.json.extensions[namespace]`；extension files 位于同名顶层目录。二者可独立存在，也可同时存在。
- README、LICENSE、CHANGELOG、旧客户端目录和其他顶层文件不是 portable component；只要没有被误写进 closed manifest，就不影响 core conformance。

## Fixture 与 harness 约束

建议把 `upstream/agent-plugins-example/` 保存为 commit-pinned Git subtree、archive snapshot 或测试下载缓存，保持字节不变；所有修改型场景从它或最小包复制到临时目录，不能改 upstream snapshot。派生 fixtures 的每个目录只表达一个主要等价类，fixture metadata 记录 `sourceSection`、`expectedPackage`、`expectedSkills`、`expectedServers`、`expectedDiagnostics` 和 `expectedLaunches`。

MCP 正向 runtime fixtures 需要 PandaWork 自有的 deterministic probe servers：

- `stdio-probe` 回传收到的 `argv`、环境、`cwd` 和 handshake，另有 exit-before-handshake 与 malformed-handshake 模式。
- `streamable-http-probe` 记录 initial transport、URL、headers、redirect origin 和 MCP handshake。
- `sse-probe` 实现 MCP 2024-11-05 legacy HTTP+SSE，记录 endpoint event 与后续请求 headers。`sse` 在 Agent Plugins v1 中明确指 legacy transport，不是 Streamable HTTP 内部使用 SSE response。[v1 §7.2.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#streamable-http-and-legacy-httpsse)

所有网络测试默认绑定 loopback 和临时端口；涉及 non-loopback HTTPS 规则时用本地受控 DNS/证书 harness 或纯配置 validation，不依赖公共服务。每个 test 使用独立 Plugin root 与 Plugin data，结束后断言没有意外进程、连接或 root 外文件访问。

## 精确自动化矩阵

下列是“完全实现协议并让官方案例运行”的最低 PandaWork acceptance corpus。`fatal` 表示整个 package 返回失败且**不得发现或执行任何组件**；`component invalid` 和 `entry invalid` 必须保留独立有效组件。错误诊断的具体 DTO 由 PandaWork 决定，但 scope、path/server/skill identity 和 reason 必须可断言，且不能泄漏 `cause`、stack 或未筛选 SDK 对象。

### A. 上游 example 与基础包

| ID | 输入 | 精确预期 |
| --- | --- | --- |
| `UP-01` | 原样 `agent-plugins-example@5f3f508...` | package 成功；identity `agent-plugins-example@1.0.0`；恰好发现 `migrate-agent-plugin`；0 MCP；0 extension dispatch；无 error diagnostic |
| `UP-02` | 激活 `migrate-agent-plugin` | 返回固定 `SKILL.md` 正文；三个相对 reference 均可从 Skill root 读取；README/LICENSE 不进入 skill catalog |
| `UP-03` | 同一固定 snapshot 分别经本地目录、archive、Git source 安装后加载 | 三者生成等价 portable descriptors；source/provenance 不混入协议 identity。这是 PandaWork 产品验收，不是 Agent Plugins 规范要求 |
| `PKG-01` | 只有最小合法 `plugin.json` | package 成功；0 Skills、0 MCP；缺少固定 component location 不报错 |
| `PKG-02` | 完整合法 manifest + Skills + 三 transport + unknown extension | 全部 portable component 按类型发现；unknown extension 安全忽略 |
| `PKG-03` | 包含 README、LICENSE、CHANGELOG、旧客户端目录和根 `.mcp.json` | 额外文件不影响 core；不得把 `.mcp.json` 或其他替代位置当 portable MCP |
| `PKG-04` | candidate root 不存在或不是目录 | fatal root error；不得继续查找附近/父目录的 `plugin.json` |
| `PKG-05` | candidate root 是指向目录的 symlink，包内路径仍在其 resolved target 下 | 以 filesystem-resolved target 作为 Plugin root，后续 containment、descriptor 与 `PLUGIN_ROOT` 都使用同一 canonical identity |

### B. Manifest 与版本选择

规范对 schema 有两个有意的 prose exception：unknown 顶层字段与**整个 `extensions` 字段不是 object**时，应报告、忽略并继续；此外，未实现 namespace 的 entry value 必须不经验证直接忽略。通用 JSON Schema validator 会把前两类判 invalid，并会验证 extension member 是 object，所以 loader 必须在语义层实现规范正文，不能把一次 schema `valid/invalid` 直接当加载结论。[v1 §5.2 与 §8.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#52-manifest-object)；[canonical plugin schema](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/schemas/1.0.0/plugin.schema.json)

| ID | 输入 | 精确预期 |
| --- | --- | --- |
| `MAN-01` | 最小 `$schema` + `name` | 成功 |
| `MAN-02` | 所有允许 metadata；`version` 非 SemVer、URL/email/license 非标准格式但类型正确 | 成功并保留原字符串；不得额外实施 schema 未规定的格式拒绝 |
| `MAN-03` | 一个或多个 unknown top-level field，其他合法 | 每个 unknown field 有 diagnostic 并被剥离；package 和组件继续加载，不赋予语义 |
| `MAN-04` | `extensions` 为 string/array/null，其他合法 | 一个 diagnostic；忽略整个字段；package 和 portable components 继续加载 |
| `MAN-05` | unknown/unimplemented extension namespace 的 value 为任意 object，另测 scalar | 不验证内容、不 dispatch、不影响 package；scalar 不得因通用 schema traversal 把 package 变 fatal |
| `MAN-06` | 缺文件、不是普通文件、或 `plugin.json` symlink 解析到 root 外 | fatal；0 discovery、0 execution |
| `MAN-07` | invalid JSON 或 JSON 顶层不是 object | fatal；0 discovery、0 execution |
| `MAN-08` | 缺 `$schema`/`name`，或字段为空/类型错误 | fatal；诊断指出字段；0 discovery、0 execution |
| `MAN-09` | unknown canonical schema、未版本化/近似 URL、未来版本 | fatal unsupported version；不得在线 fetch schema |
| `MAN-10` | name 边界 `a`、64 chars、period 合法 | 成功 |
| `MAN-11` | name 空、65 chars、uppercase、非法字符、首尾 `-`/`.`、`--`、`..` | 每个等价类 fatal |
| `MAN-12` | 允许 metadata 的错误类型；`author` unknown field 或非 string member | 每个等价类 fatal |
| `MAN-13` | manifest fatal，但目录同时含可执行 stdio probe 与合法 Skill | probe 从未启动，Skill 从未进入 catalog；证明 manifest failure boundary |

### C. 固定位置、路径与 Skills

包内所有被发现、读取或执行的路径在 filesystem resolve 后必须留在 resolved Plugin root；symlink、junction、reparse point 同等处理。失败要落在最窄边界，而不是一律拒绝整包。[v1 §4.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#41-general-requirements)

| ID | 输入 | 精确预期 |
| --- | --- | --- |
| `DISC-01` | `skills/` 或 `mcp.json` 缺失 | 对缺失类型无 error；其他类型照常加载 |
| `DISC-02` | `skills` 是文件/解析到 root 外；合法 `mcp.json` 同在 | Skills component invalid；MCP 保留 |
| `DISC-03` | `mcp.json` 是目录/解析到 root 外；合法 Skill 同在 | MCP component invalid；Skill 保留 |
| `DISC-04` | manifest 试图声明 component path，或 component 放在 nested/alternative path | unknown manifest field 按 `MAN-03` 忽略；只扫描 fixed locations |
| `DISC-05` | `skills` 或 `mcp.json` 经 symlink 解析到 root 内的正确 filesystem kind | 对应 component 可加载；所有返回路径 canonicalize 后仍在 resolved root 内 |
| `SKL-01` | 官方 Skill 与三个 references | 通过 Agent Skills 校验，恰好发现一次，references 读取受 root containment 保护 |
| `SKL-02` | `skills/<name>/SKILL.md` 为普通文件；同目录可含 scripts/references/assets/任意其他文件 | 发现一个 Skill；额外资源不单独注册为 component |
| `SKL-03` | `skills/SKILL.md`、`skills/<name>/skill.md`、普通文件 child、没有 `SKILL.md` 的 child | 全部忽略，不误报为 discoverable Skill |
| `SKL-04` | `skills/a/nested/b/SKILL.md` | 不递归发现 `b` |
| `SKL-05` | `SKILL.md` symlink 解析到 root 内普通文件 | 可发现；descriptor 使用 canonical contained path |
| `SKL-06` | `SKILL.md` symlink/junction 解析到 root 外 | 只 skip 该 Skill并报告；合法 sibling 与 MCP 保留 |
| `SKL-07` | 缺/坏 YAML frontmatter、缺 name/description、name 与目录不匹配、name/description 边界违规、可选字段类型违规 | 每个 invalid Skill 被独立 skip；其他 Skill/component 保留。规则固定到 Agent Skills commit [`217be548...`](https://github.com/agentskills/agentskills/blob/217be548739f21d6008915c29aefe320ea1a90af/docs/specification.mdx#skillmd-format) |
| `SKL-08` | Skill 中引用 root 内资源与 root 外 symlink 资源 | root 内读取成功；root 外访问被拒绝，但不反向删除已经发现的其他 component |

### D. `mcp.json` 顶层与 per-server 校验

schema 暴露 `#/$defs/server` 正是为了让客户端逐 server 校验并保持失败隔离；top-level invalid 禁用插件的全部 MCP，server invalid 只跳过该 entry。[v1 §7.2.1、§7.2.2](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#721-discovery-and-configuration)；[canonical MCP schema](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/schemas/1.0.0/mcp.schema.json)

| ID | 输入 | 精确预期 |
| --- | --- | --- |
| `MCP-01` | 合法 schema + 空 `mcpServers` | MCP config 成功，0 server，无 error |
| `MCP-02` | invalid JSON、非 object、缺 `$schema`/`mcpServers`、`mcpServers` 非 object、unknown top-level field | 每类均 disable 此插件全部 MCP并报告；Skills 保留 |
| `MCP-03` | unsupported MCP schema 或与 `plugin.json` Agent Plugins version 不同 | disable 全部 MCP并报告 unsupported/mismatch；Skills 保留；不在线 fetch |
| `MCP-04` | 多 server，其中一个缺/unknown `type`、混入另一 variant 字段、unknown field、wrong field type | 只 skip invalid entry；合法 siblings 与 Skills 保留 |
| `MCP-05` | connection/start/auth/handshake failure server + healthy siblings | 失败 server 有 runtime diagnostic；healthy server 与 Skills 保留 |
| `MCP-06` | capability mask 模拟不支持某 transport | otherwise-valid server 被 skip 并报告 unsupported；其他 server/component 保留。正式 PandaWork profile 则三 transport 均必须 supported |

### E. stdio transport、环境与变量展开

`${PLUGIN_ROOT}` 和 `${PLUGIN_DATA}` 只在 `args` 每个 string、`env` value 和 `cwd` 中作一次、非递归、精确文本替换；不展开 `command`、`env` key、URL、header 或固定位置，未知 placeholder 保持 literal。[v1 §9](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#9-environment-variables-and-placeholder-expansion)

| ID | 输入 | 精确预期 |
| --- | --- | --- |
| `STD-01` | bare executable、无 `cwd` | 按平台 executable search 启动一个 token；argv 分离；实际 cwd 为 resolved Plugin root |
| `STD-02` | bundled `./bin/stdio-probe` | command 对 Plugin root resolve、通过 containment 后启动；不经 shell 字符串解析 |
| `STD-03` | `args` 与 `env` value 各含两个 root/data placeholder 和 unknown placeholder | 每个 exact occurrence 替换；unknown 保留 literal；probe 观测值精确匹配 |
| `STD-04` | replacement value 自身含 `${PLUGIN_DATA}` 文本 | 单次替换，不扫描替换产物，证明 non-recursive |
| `STD-05` | `cwd` 分别为 `./subdir`、`${PLUGIN_ROOT}`、`${PLUGIN_ROOT}/subdir`、`${PLUGIN_DATA}`、`${PLUGIN_DATA}/subdir` | 五种均在 expand + canonical containment 后启动，probe 观测 cwd 正确 |
| `STD-06` | 配置 env 覆盖 base env | configured env 后置覆盖 base；随后 client 强制写入真实 `PLUGIN_ROOT`/`PLUGIN_DATA`；data 目录启动前已创建且可写 |
| `STD-07` | `env` 直接定义 `PLUGIN_ROOT` 或 `PLUGIN_DATA`（含平台等价 casing） | server entry invalid，不启动；siblings 保留 |
| `STD-08` | `command` 为 shell string、绝对 path、`../x`、`${PLUGIN_ROOT}/x` | 每类 entry invalid；不做 placeholder expansion，不启动 |
| `STD-09` | `cwd` 为 `data`、绝对 path、`../x`、root/data placeholder 展开后 escape，或通过 symlink escape | 每类 entry invalid；siblings 保留 |
| `STD-10` | `args`/`env` value 包含 `../` 或绝对 path 字符串 | 作为 opaque string 传递，不错误实施 package-path containment |
| `STD-11` | `command`/`env` key 含 placeholder；另有 `$HOME`、`%VAR%` 等文本 | 不做额外 expansion；command 若因此不满足 token/path 规则则 entry invalid，其他文本 literal |
| `STD-12` | stdio probe 正常 handshake、启动即退出、输出 malformed MCP、超时 | 正常 server 可用；其他三类分别是 runtime connection failure，均不拖垮 sibling/component |
| `STD-13` | 同一 installed plugin 跨版本 root 切换后重启 probe | `PLUGIN_ROOT` 指向新 immutable root；`PLUGIN_DATA` identity/path 和内容保持。这一持久性是 §9.1 的规范要求，原子 root 切换细节属于 PandaWork lifecycle |

### F. Streamable HTTP 与 legacy SSE

remote URL 必须是无 userinfo、无 fragment 的 absolute HTTP(S) URL；非 loopback 必须 HTTPS，HTTP 只允许 host **恰好**为 `localhost` 或 loopback IP literal。headers 是 literal visible package data，不是 secret；client-generated header 优先，跨 origin redirect/legacy SSE endpoint event 未经明确授权不能转发 configured headers。[v1 remote transport rules](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#streamable-http-and-legacy-httpsse)

| ID | 输入 | 精确预期 |
| --- | --- | --- |
| `HTTP-01` | loopback HTTP Streamable HTTP probe | 使用 declared `streamable-http` 完成 MCP handshake，不 fallback |
| `HTTP-02` | loopback HTTP legacy SSE probe | 使用 MCP 2024-11-05 `sse` 完成 endpoint event 与 handshake，不误当 Streamable HTTP |
| `HTTP-03` | HTTPS absolute URL；HTTP `localhost`、IPv4 loopback、IPv6 loopback | 配置合法；连接结果按 runtime 单独报告 |
| `HTTP-04` | relative URL、非 HTTP(S)、userinfo、fragment、non-loopback HTTP、`localhost.evil` HTTP | 每类 server entry invalid；不发网络请求；siblings 保留 |
| `HTTP-05` | 合法 literal headers + URL path/header value 含 `${PLUGIN_ROOT}`、`${PLUGIN_DATA}`、`$HOME` | URL/header 原样发送，不做 placeholder/env expansion |
| `HTTP-06` | invalid header name/value 或同名不同 casing 的重复 header | server entry invalid；不连接；siblings 保留 |
| `HTTP-07` | configured header 与 client HTTP/MCP/auth header 大小写冲突 | client-generated value 胜出；configured value 不发送 |
| `HTTP-08` | same-origin redirect | 可继续并只按 HTTP policy发送 header；transport 不变 |
| `HTTP-09` | cross-origin redirect，未授权/明确授权两种 | 未授权时 configured headers 不转发；授权后才可转发；两种均可审计 |
| `HTTP-10` | legacy SSE endpoint event 指向不同 origin，未授权/明确授权两种 | 与 `HTTP-09` 相同的 configured-header 边界 |
| `HTTP-11` | 401/403、连接拒绝、TLS/handshake failure、MCP handshake failure | 都是该 server 的 runtime connection failure，不误判 package/config fatal；siblings 与 Skills 保留 |
| `HTTP-12` | declared transport endpoint 只支持另一 transport | initial attempt 仍只用 declared transport；失败后不进行规范外 fallback |

规范无法可靠自动判断任意 header/env string 是否“看起来像 secret”；conformance 能断言的是“不展开、不覆盖 client credential、不跨 origin 泄漏”。真正的 secret 扫描、连接存储和用户批准属于 PandaWork trust policy，不能伪装成 v1 schema 规则。

### G. Client extensions

Agent Plugins 只规定 namespace 的放置与未知 namespace 的忽略；它不规定 extension 内部 schema、runtime 或失败语义。[v1 §8](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#8-client-extensions)

| ID | 输入 | 精确预期 |
| --- | --- | --- |
| `EXT-01` | unimplemented `com.example.client` manifest object | 不验证内容、不 dispatch、不报“不支持”错误；portable components 保留 |
| `EXT-02` | unimplemented namespace value 为 scalar/array/null | 不读取内部、不因 canonical schema 的 member-object 约束拒绝 package；portable components 保留 |
| `EXT-03` | 顶层 `com.example.client/`，manifest 无同 namespace；反向组合亦然 | 两种 representation 可独立存在；unsupported extension 都安全忽略 |
| `EXT-04` | 同 namespace 同时有 manifest data 与顶层目录 | PandaWork 只对自己实现的 namespace dispatch；其他 namespace 两侧都忽略 |
| `EXT-05` | implemented `com.pandawork.*` 的合法/无效 data/files | 由 PandaWork extension contract 单独校验和隔离；不能把其能力登记为 portable v1 component |
| `EXT-06` | extension 文件路径 symlink 到 root 外 | 任何读取/执行均由 package containment 拒绝；portable core 保留，除非 PandaWork namespace contract 明确规定更窄失败行为 |
| `EXT-07` | 形似 namespace 但不满足 reverse-domain convention 的 unknown key/directory | 不赋予 portable 语义；v1 schema 没有 namespace regex，客户端不得凭自造通用 schema 把其他合法 core 变 fatal |

### H. 组合故障隔离与诊断

| ID | 输入 | 精确预期 |
| --- | --- | --- |
| `ISO-01` | fatal manifest + 所有 component canary | package rejected；0 Skill/MCP/extension discovery 与 0 process/network side effect |
| `ISO-02` | invalid `skills` fixed location + healthy MCP | 只失去 Skills component type |
| `ISO-03` | 一个 invalid Skill + healthy Skill/MCP | 只 skip 该 Skill |
| `ISO-04` | invalid `mcp.json` top-level + healthy Skills | 禁用该插件全部 MCP，Skills 保留 |
| `ISO-05` | 一个 invalid/unsupported MCP entry + healthy siblings/Skills | 只 skip 该 entry |
| `ISO-06` | 一个 start/connect/auth/handshake failed server + healthy siblings/Skills | 只隔离该 runtime instance |
| `ISO-07` | unsupported extension + healthy portable core | 安静忽略，不把“缺乏 extension 支持”当 error |
| `ISO-08` | 每一种非 fatal failure | diagnostic 的 scope 与 identity 正确；同一输入顺序稳定；跨 UI/RPC 只输出白名单字段 |

## “案例可以运行”的完成定义

CI 不应只做 JSON parse。完成需要同时满足：

1. 固定 example snapshot 的 SHA-256 未漂移，且 PandaWork 不需要 patch 它。
2. `UP-01` 与 `UP-02` 在实际 PandaWork Skill catalog/activation 路径通过；官方 Skill 的三个 references 真正可读。
3. 三个 probe server 分别经过正式 stdio、Streamable HTTP、legacy SSE adapter 完成 MCP initialize、capability/tool discovery、一次调用与正常 cleanup。
4. 上述负向矩阵证明没有被禁止的 process spawn、network request、header forward 或 root 外路径访问。
5. Linux/macOS 至少运行完整 suite；Windows 运行 path/casing/junction、`.cmd` launch 和环境名等价性的专项 suite。规范明确把 junction/reparse point 与 symlink 一并纳入 containment，也允许 Windows command interpreter 启动已解析的单 token executable。[v1 §4.1、§7.2.1](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#41-general-requirements)
6. 本地目录、archive、Git 三种 source 对相同 package bytes 产生相同 portable descriptors；安装 provenance、trust、Plugin data 与更新状态作为 PandaWork 外层字段测试。

协议 conformance 与产品承诺要分开命名：`agent-plugins-v1-conformance` 只断言规范行为；`pandawork-agent-plugin-acceptance` 追加三 source、三 transport 全支持、trust、安装更新和 `com.pandawork.*`。这样 PandaWork 可以宣称比 v1 最低 client 要求更完整，而不会把自身安装器或私有 extension 误称为协议内容。

## 上游更新策略

- CI 日常使用 vendored/frozen bytes，不访问网络。
- 单独的人工/定时 drift job 比较两个 upstream `main` 与固定 commit；发现变化只报更新候选，不自动替换 fixture。
- 升级时先 diff normative prose，再 diff 两份 schema，最后 diff example；重新计算摘要并完整跑矩阵。
- 若上游未来发布官方 conformance suite，先作为新的 upstream corpus 并行运行；在确认它覆盖本报告的 prose exceptions、三 transport 和失败隔离前，不删除 PandaWork 派生 fixtures。

## 对后续决策票的输入

1. conformance harness 的核心不是“拷贝一个示例目录”，而是 `1 upstream snapshot + deterministic MCP probes + matrix-driven derived packages + side-effect observers`。
2. 官方 example 可作为最早的 blocking smoke test，但它只证明 manifest + Skill 正向路径。
3. PandaWork 既然承诺三 transport，就必须把 `sse` 纳入正式 profile；v1 的最低 conformance 本来只要求 stdio/Streamable HTTP 至少一种，不能拿最低线替代本地图已决定的产品目标。[v1 transport support](https://github.com/agentplugins/agent-plugins-spec/blob/bd383552095128f6effe895b9257cfd580a6d179/spec/1.0.0.md#transport-support)
4. `plugin.schema.json` 不能单独表达 prose exception 和 failure boundary；loader 与 tests 都需要两阶段/分层 validation。
5. `com.pandawork.*` 的内部 schema 与 runtime 测试应挂在同一 harness，但结果必须与 portable conformance 分栏报告。
