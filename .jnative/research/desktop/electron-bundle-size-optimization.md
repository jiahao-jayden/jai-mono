# Electron Desktop 打包体积优化调研

核验日期：2026-09-12。外部源码固定在 VS Code `a8f49160195d9e967d2d51e8544dc895207518e7`、VSCodium `5a73682ca091082675b10c9dc3f348c1d824d94f`、GitHub Desktop `8eb43b9bc99d866f89b8ca8f8043bdd80ea0a2a2`、Signal Desktop `6aea489bd04f31f6070538ffdbcea9fcf492479d`、Element Desktop `87baf1246be4e94345f84c2b74b75092243c5b35`；Electron 文档和 electron-builder 文档使用各自笔记中记录的固定 SHA。JAI 基线来自当前工作区现有 macOS ARM64 产物：zip `119701350` bytes，`Electron Framework.framework` `271M`，`app.asar` `14M`，`Resources/dist` `24M`。

## 结论

1. JAI 最大的体积来源是 Electron Framework：当前未压缩约 `271M`，而整个 macOS ARM64 zip 约 `120MB`。ASAR、tree-shaking 和 agent bundle 只能减少应用层内容，不能消除 Electron runtime。[JAI 基线与官方性能文档](https://github.com/electron/electron/blob/bb7a80aa84a1d21f477a9132c8ccf6f03aa8d698/docs/tutorial/performance.md#L37-L47)

> The most successful strategy for building a performant Electron app is to profile the running code, find the most resource-hungry piece of it, and to optimize it.

2. 第一优先级是给 Desktop 建立专用 `files`/资源白名单，并只复制实际启动所需的 runtime 文件。Signal 明确排除源码、测试、map、通用 prebuild，并按 `${platform}-${arch}` 选择原生文件；Element 只把 `lib/**`、必要依赖和 `webapp.asar` 放入壳。[Signal files 白名单](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L225-L302)

> "!ts/**", "!build", "!**/*.{bak,bnf,flow,patch,markdown,ts,map}", "!**/node_modules/**/prebuilds/**"

3. JAI 当前把整个 `app/server/dist` 作为 `extraResource` 带入 Desktop，但已确认 Desktop 启动的是 `Resources/dist/main.js`；`stdio-main.js`、多个 client entrypoint 和 trajectory browser 不属于这个启动路径。类似 Element 的“壳只带必要入口”是最直接的低风险裁剪点。[Element 壳的 files/extraResources](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L93-L126)

> files: ["package.json", { from: ".hak/hakModules", to: "node_modules" }, "lib/**"],
> extraResources: ["build/icon.*", "webapp.asar"],

4. 原生模块必须按目标 OS/架构保留并放在 ASAR 外；删错 native 文件会出现“构建成功、运行时缺模块”。Signal 将 `.node` 统一列入 `asarUnpack`，electron-builder 维护者也确认跨架构和 workspace 依赖收集会带来错误架构风险。[Electron native ABI 文档](https://github.com/electron/electron/blob/e86580ed49c20d98a2d4720d5952a593ac69d07a/docs/tutorial/using-native-node-modules.md#L1-L43)

> Native Node.js modules are supported by Electron, but since Electron has a different application binary interface (ABI) ... the native modules you use will need to be recompiled for Electron.

5. JAI 的 FFF runtime 是应用层第二个明确的大项：`libfff_c.dylib` 约 `9.7MB` 未压缩；同一目录还复制了 `.d.ts`、`.map`、README 和双份入口。应保留目标架构的 dylib、ffi binding、必要 JS 和 package metadata，删掉开发文件。[JAI FFF 产物清单](https://github.com/electron-userland/electron-builder/issues/9423)

> cross-architecture builds ... shipped transitive native modules ... for the wrong architecture.

6. 前端高亮资源也是可见的应用层浪费：当前 `app/desktop/dist/assets` 有 `317` 个文件、约 `13M`，包含大量语言与主题 chunk。Signal 的生产构建使用 minify、多个明确入口和按需 chunks；JAI 可以只保留实际支持的语言，或延迟加载语言包。[Signal 生产构建](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L67-L109)

> "build:rolldown:prod": "pnpm build:rolldown --minify"

7. `compression: "maximum"` 不应作为主要优化手段。electron-builder 维护者的配置注释明确说它通常没有明显体积收益，却会增加构建时间；应先消除重复资源和错误的依赖输入。[electron-builder 配置注释](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/packages/app-builder-lib/src/options/PlatformSpecificBuildOptions.ts#L1-L20)

> `maximum` doesn't lead to noticeable size difference, but increase build time.

8. 增量更新能减少后续更新下载量，但不减少首装包；NSIS-Web 能避免一个安装器捆绑所有架构，macOS zip 当前则应继续按 arm64/x64 分包。universal 包可能同时包含两套原生文件。[electron-builder NSIS-Web 文档](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/website/docs/nsis.md#L1-L12)

> Web Installer automatically detects OS architecture and downloads corresponding package file.

## 开源项目怎么做

这张表回答同一个问题：它们把体积控制放在构建输入、归档边界、平台依赖还是更新分发层。

| 方案 | 构建输入 | 归档边界 | 原生模块 | 不成立条件 |
|---|---|---|---|---|
| VS Code | 生产依赖独立归档，扩展按平台过滤。[源码](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/build/lib/asar.ts) | `node_modules.asar` + `.unpacked` | 需要真实路径的内容必须解包 | universal 可能携带两套架构文件 |
| VSCodium | 从依赖图删除 Copilot 及其构建输入。[patch](https://github.com/VSCodium/vscodium/blob/5a73682ca091082675b10c9dc3f348c1d824d94f/patches/53-ext-copilot-remove-it.patch) | 沿用 VS Code | 沿用上游 | 删除功能会改变产品能力 |
| Signal Desktop | Rolldown minify，多入口，`files` 白名单。[源码](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L225-L302) | ASAR + `.node` unpack | 只选当前平台/架构 prebuild | sandbox preload 不能共用 `require()` 环境 |
| Element Desktop | Web 应用先构建为 `webapp.asar` | Electron 壳只保留 `lib/**` 和必要依赖。[源码](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L93-L126) | `.node` unpack，hak 管理 | 壳仍需原生模块与平台资源 |
| GitHub Desktop | 自己复制依赖并手工 prune | 当前 `asar: false`，不能证明关闭 ASAR 更小。[源码](https://github.com/desktop/desktop/blob/8eb43b9bc99d866f89b8ca8f8043bdd80ea0a2a2/script/build.ts) | 由清理流程维护 | 手工 prune 误删会造成运行时缺依赖 |

## 重复资源和 ASAR 边界

electron-builder 维护者确认，同一大型文件同时出现在 `files` 与 `asarUnpack` 会进入 `app.asar` 和 `app.asar.unpacked` 两份；静态外部资源应使用 `extraResources` 或 `extraFiles`，不要同时列入 `files`。[维护者回复](https://github.com/electron-userland/electron-builder/issues/2290#issuecomment-401005093)

> It appears twice in the final package:
> Contents/Resources/app.asar.unpacked/build/a-large-binary-file
> Contents/Resources/app.asar/build/a-large-binary-file

Electron ASAR 文档也说明，unpacked 目录必须和 `app.asar` 一起发布，所以解包解决的是路径和加载限制，不会自动减少总包体积。[ASAR 文档](https://github.com/electron/electron/blob/fff9483bdcb5dbf5d1d4f2f35ad527ff5068e03d/docs/tutorial/asar-archives.md#L1-L30)

> `app.asar.unpacked` ... should be shipped together with the `app.asar` archive.

## 关键原文摘录

Electron 官方把依赖数量和加载资源列为应用性能与体积分析的入口。[官方性能文档](https://github.com/electron/electron/blob/bb7a80aa84a1d21f477a9132c8ccf6f03aa8d698/docs/tutorial/performance.md#L37-L47)

> Before adding a Node.js module to your application, examine said module.
> How many dependencies does that module include?

Signal 的生产构建显式开启 minify。[Signal 生产构建](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L67-L109)

> "build:rolldown:prod": "pnpm build:rolldown --minify"

Signal 的 `files` 规则排除了源码、测试、map 和通用 prebuild。[Signal files 白名单](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L225-L302)

> "!ts/**", "!build", "!**/*.{bak,bnf,flow,patch,markdown,ts,map}", "!**/node_modules/**/prebuilds/**"

Electron 的 native module 必须匹配 Electron ABI、平台和架构。[Electron native ABI 文档](https://github.com/electron/electron/blob/e86580ed49c20d98a2d4720d5952a593ac69d07a/docs/tutorial/using-native-node-modules.md#L1-L43)

> Make sure the native module is compatible with the target platform and architecture for your Electron app.

electron-builder 的配置注释说明 maximum 压缩通常没有明显体积收益。[electron-builder 配置注释](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/packages/app-builder-lib/src/options/PlatformSpecificBuildOptions.ts#L1-L20)

> `maximum` doesn't lead to noticeable size difference, but increase build time.

当前 JAI 的 FFF 依赖收集与跨架构问题必须以实际目标架构验证。[electron-builder native module issue](https://github.com/electron-userland/electron-builder/issues/9423)

> no node modules returned while searching directories

NSIS-Web 按系统架构下载对应 package file。[electron-builder NSIS-Web 文档](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/website/docs/nsis.md#L1-L12)

> Web Installer automatically detects OS architecture and downloads corresponding package file.

## 对 JAI 的建议顺序

1. 把 `app/server/dist` 改成 Desktop 专用 runtime 目录，只复制 `main.js`、FFF 必需的 `node_modules` 和实际需要的资源；不要改变 agent 代码边界。
2. 对 FFF staged 目录做 allowlist，删除 `.d.ts`、`.map`、README、未使用入口；在 arm64 上验证 dylib、ffi binding 和 `main.js` 都能加载。
3. 对 `app.asar` 和 `Resources` 做重复文件审计，确保大型静态文件只出现在一个位置。
4. 为 Shiki/代码高亮做语言 allowlist，再用真实聊天、代码块、PDF、MCP/原生模块流程做 smoke test。
5. 最后再比较 `normal` 与 `maximum`，并分别记录首装 zip、解压 app、Framework、应用资源和更新 delta。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | Electron performance、ASAR、native modules、fuses；VS Code、VSCodium、Signal、Element、GitHub Desktop 的固定 commit 构建源码；electron-builder 固定 commit 文档和配置类型。 |
| 作者或维护者本人的说法 | Electron 官方性能与 native ABI 文档；electron-builder 维护者在 #2290 对重复打包的明确回复。 |
| 同类方案 | VS Code、VSCodium、Signal Desktop、Element Desktop、GitHub Desktop 五个开源 Electron 项目，按统一维度比较。 |
| issue / PR / 社区实践 | electron-builder #2290 重复资源、#2499 增量更新、#9423 workspace/native module 收集问题；普通用户反馈单独标注，未用于推导普遍性。 |
| 历史演变 | 对照 electron-builder 19.x/26.x、Electron 37 文档与当前项目构建快照；只用于说明版本敏感性，不把旧行为外推到 JAI。 |

## 待验证

- JAI 专用 runtime allowlist 的最小闭包和实际节省字节数。
- FFF 原生库压缩后的实际 zip 节省量。
- Shiki 语言 allowlist 对代码块、主题和首屏加载的影响。
- 是否存在 `app.asar`、`Resources/dist` 与 `.asar.unpacked` 的重复大文件。
- universal 产物与 arm64 单架构产物在发布渠道上的首装差异。

## 对本项目的影响

JAI 当前约 `120MB` 的 zip 里，约 `271M` 未压缩空间来自 Electron Framework，应用层资源约 `38M`（`app.asar` 与 runtime dist）。因此短期合理目标是先把应用层裁剪到更小，预计能获得数 MB 到十几 MB 的下载收益；把包体积降到几十 MB 需要更换 Electron runtime 方案，不能靠打包参数完成。

优先实施 Desktop 专用 runtime 和资源 allowlist；这两项直接对应 JAI 当前 `Resources/dist` 的内容，也符合 Signal、Element 和 VS Code 的共同做法。压缩级别、V8 snapshot 和增量更新放在后面评估：前者主要增加构建时间，后两者分别针对启动时间和后续更新下载量。
