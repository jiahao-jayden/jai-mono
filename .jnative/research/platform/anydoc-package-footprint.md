# Anydoc：npm 包、依赖体积与本机安装诊断

> 调研日期：2026-08-09（Asia/Singapore）  
> 范围：Firecrawl 官方 npm registry 元数据、`firecrawl/anydoc` 源码，以及在本机 Apple Silicon (`darwin/arm64`, Node `v22.15.0`) 对官方 npm tarball 的隔离加载验证。没有修改产品依赖或锁文件。

## 结论先行

应安装的包是 **`@firecrawl/anydoc`**，不是 `anydoc`。当前发布版为 `0.1.7`，要求 Node `>=20`；本机 Node `v22.15.0` 满足条件。[npm 包元数据（0.1.7）](https://registry.npmjs.org/%40firecrawl%2Fanydoc/0.1.7)

它不是纯 JavaScript 转换器，而是 N-API 的预编译 Rust 原生模块：主包通过 `optionalDependencies` 为不同操作系统挑选二进制包。本机会选 `@firecrawl/anydoc-darwin-arm64@0.1.7`，不需要安装 Rust、Python、LibreOffice 或 OCR 模型。[主包元数据](https://registry.npmjs.org/%40firecrawl%2Fanydoc/0.1.7)；[macOS arm64 包元数据](https://registry.npmjs.org/%40firecrawl%2Fanydoc-darwin-arm64/0.1.7)

**本机首装的实际量级约为 2.94 MiB 下载、6.59 MiB 解包后磁盘占用。** 这包含 10,192 B 的主包 tarball 和 3,074,775 B 的 Apple Silicon 二进制 tarball；npm registry 报告的解包大小分别为 49,239 B 与 6,859,389 B。不是一个会拉下数百 MB 模型或 Office 运行时的依赖。

## 正确安装方式

项目使用 Bun。当前终端环境中的 `http_proxy`、`https_proxy` 与 `all_proxy` 都指向 `127.0.0.1:7890`；本机没有该代理监听时，Bun、npm 和 GitHub 请求都会走向一个失效的本地代理。

先只对本次安装绕过它：

```sh
env -u http_proxy -u https_proxy -u all_proxy \
  -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  bun add @firecrawl/anydoc
```

如果团队本来就需要代理，应先启动/修复实际监听 `127.0.0.1:7890` 的代理客户端，再正常执行：

```sh
bun add @firecrawl/anydoc
```

不要通过手动安装 `@firecrawl/anydoc-darwin-arm64` 来替代主包：主包负责根据平台载入对应绑定，且会随将来的 macOS/Linux/Windows 构建自动选择。发布包的加载器会先尝试本地二进制，再按平台 `require` 对应的 `@firecrawl/anydoc-*` 包。[发布的加载器源码](https://github.com/firecrawl/anydoc/blob/4a45addbd607e8b59f0c263bca26aab228e10370/node/index.js)

### 为什么这次“无法连接”

这是网络配置问题，不是 Anydoc 包不存在或二进制不兼容：

1. 当前 shell 的三项小写代理变量均指向 `127.0.0.1:7890`；若本地代理未运行，包管理器会连接失败。
2. 在受限执行环境中，绕过代理后的普通直连 DNS 也会被拦截；但在允许直连的只读请求中，npm registry 已返回 `@firecrawl/anydoc@0.1.7` 与 `@firecrawl/anydoc-darwin-arm64@0.1.7` 官方元数据、tarball 和签名。因此包的 registry 端是可达的。
3. 应先用上面的单次 `env -u … bun add` 确认；只有它仍失败时，再检查 DNS/VPN/公司网络策略，而不是改 package name 或退回手写文档解析器。

## 生产安装树与体积

| 项目 | 生产关系 | 压缩下载（本机实测） | registry 解包大小 | 说明 |
| --- | --- | ---: | ---: | --- |
| `@firecrawl/anydoc@0.1.7` | 直接安装 | 10,192 B | 49,239 B | JS loader、类型、CLI、README；5 个文件 |
| `@firecrawl/anydoc-darwin-arm64@0.1.7` | 仅在 macOS arm64 作为 optional dependency 安装 | 3,074,775 B | 6,859,389 B | 3 个文件；其中 `anydoc.darwin-arm64.node` 为 6,858,496 B |
| 合计（此机器） | 主包 + 唯一匹配平台包 | **3,084,967 B / 2.94 MiB** | **6,908,628 B / 6.59 MiB** | 不会同时安装其他平台的二进制 |

主包没有普通的 `dependencies`，只有 7 个固定版本的跨平台 `optionalDependencies`：macOS x64/arm64、Linux x64/arm64（glibc/musl）和 Windows x64 MSVC。每个二进制包都带 OS/CPU 约束，因此当前机器只解析 Apple Silicon 包。[主包元数据](https://registry.npmjs.org/%40firecrawl%2Fanydoc/0.1.7)；[Apple Silicon 包元数据](https://registry.npmjs.org/%40firecrawl%2Fanydoc-darwin-arm64/0.1.7)

作为参照，同版 x64 包实测压缩下载为：macOS 3,214,412 B（registry 解包 7,273,538 B），Linux glibc 3,405,703 B（registry 解包 8,009,799 B）。这些不属于此机器的安装结果。[macOS x64 元数据](https://registry.npmjs.org/%40firecrawl%2Fanydoc-darwin-x64/0.1.7)；[Linux x64 glibc 元数据](https://registry.npmjs.org/%40firecrawl%2Fanydoc-linux-x64-gnu/0.1.7)

### 原生与供应链边界

- npm 运行时没有额外的 JS 依赖树；`@napi-rs/cli` 是发布端开发依赖，不会随消费者安装。[Node package manifest](https://github.com/firecrawl/anydoc/blob/4a45addbd607e8b59f0c263bca26aab228e10370/node/package.json)
- 解析器的 Rust 依赖会编译进 `.node` 二进制，而不是在用户机器上另行下载。上游直接依赖包括 `calamine`（表格）、`cfb`（旧 Office 复合文件）、`csv`、`encoding_rs`、`pdf-inspector`、`quick-xml`、`zip` 和 `flate2`；Node binding 使用 `napi`/`napi-derive`。[Rust manifest](https://github.com/firecrawl/anydoc/blob/4a45addbd607e8b59f0c263bca26aab228e10370/Cargo.toml)；[Node binding manifest](https://github.com/firecrawl/anydoc/blob/4a45addbd607e8b59f0c263bca26aab228e10370/node/Cargo.toml)
- 对下载的 Apple Silicon `.node` 执行 `otool -L`，仅显示 macOS 系统组件 `CoreFoundation`、`libSystem`、`libiconv`；没有另一个随 npm 安装的第三方 `.dylib`。这不代表没有 Rust 代码——它已经静态地编进 6.54 MiB 的绑定。
- 它不做 OCR：扫描件或仅含图片的 PDF 会返回 `unsupported`。因此 Anydoc 适合作为“本地提取为 Markdown”的 fallback，不能替代 provider 原生 PDF/图片附件或 OCR 服务。[Node README：格式与错误](https://github.com/firecrawl/anydoc/blob/4a45addbd607e8b59f0c263bca26aab228e10370/node/README.md)

## API 与本机隔离验证

安装后应使用 bytes API，避免把桌面进程的原始路径扩散到业务层：

```ts
import { toMarkdownBytes } from "@firecrawl/anydoc";

const markdown = await toMarkdownBytes(bytes, "docx");
```

官方还提供 `toMarkdown(path)`、`toDocument(bytes)`、`formatFromBytes`、`formatFromExtension` 与 `formatFromPath`。`toMarkdownBytes` 会从内容检测有签名的格式；CSV 无签名，需要显式传入 `"csv"` 或使用扩展名 API。[类型声明](https://github.com/firecrawl/anydoc/blob/4a45addbd607e8b59f0c263bca26aab228e10370/node/index.d.ts)；[Node README：Usage](https://github.com/firecrawl/anydoc/blob/4a45addbd607e8b59f0c263bca26aab228e10370/node/README.md)

本次没有把包写进仓库：从官方 `0.1.7` 的两份 tarball 解到 `/private/tmp` 后，Node `v22.15.0` 能成功 `require("@firecrawl/anydoc")`，并对上游 `tests/fixtures/docx/text.docx` 调用 `toMarkdown`，得到 `# Fixture Document` 开头的 Markdown。这验证了本机 `darwin-arm64` 原生绑定可以加载；真正加入 `bun.lock` 仍应在代理/DNS 修复后执行上面的 `bun add`。

## 上游源码的量级与资产

2026-08-09 下载的上游 `main` 源码归档为 633,920 B（约 619 KiB），解压后约 3.5 MiB。该归档含约 2.1 MiB 的测试 fixtures 与 760 KiB 的 `src/`；最大的内容是 `.ppt`、DOCX 和 PDF 测试文档，而不是模型权重。归档中未发现 `.onnx`、`.model`、`.dylib`、`.so`、`.dll` 或已编译 `.wasm` 资产；Web demo 的两份 GeistMono 字体各约 28 KiB。源码明确将扫描 PDF/OCR 留给外部 Firecrawl Parse，而非随 Node 包分发。[仓库 README](https://github.com/firecrawl/anydoc/blob/4a45addbd607e8b59f0c263bca26aab228e10370/README.md)；[上游仓库](https://github.com/firecrawl/anydoc)

## 对本项目附件方案的含义

Anydoc 的包体积对桌面应用可以接受，但它只应该运行在“模型没有原生文件能力，需要把文档本地降级为文本”的分支：图片/PDF 优先走 provider 原生输入；Office/ODF/EPUB/RTF/CSV 可在必要时用 `toMarkdownBytes` 提取；扫描 PDF、加密/损坏/超资源限制文件返回受控领域错误并提示用户。不要把它当作保存附件路径或附件字节的理由。
