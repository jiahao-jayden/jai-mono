# Electron 安装包体积：官方方案、限制与无效做法

核验日期：2026-09-12。Electron 文档固定到源码提交 `1cf98129e42ca3bff2b9ca13c78b65f10a156718`；electron-builder 源码固定到 `99b6c7f1efe761bbd3d0582e158a8f1705f652a0`；Electron Forge 源码固定到 `8a29c3fa537319799cd5901d90939ae8e0eae9cf`。使用完整 SHA，是为了避免后续文档、配置 schema 或构建实现变化混入结论。维护者 issue 结论按 issue/评论固定链接记录。

## 结论

1. Electron 的固定成本来自 Chromium、Node.js、V8 及 Electron 自身的 patched 集成；应用配置不能把这些运行时组件从标准 Electron 分发包中裁掉。可行的优化边界主要是应用层文件、依赖、原生模块变体和发行物压缩。[Electron 维护者讨论](https://github.com/electron/electron/issues/2003#issuecomment-113404825) [Electron 维护者讨论](https://github.com/electron/electron/issues/2003#issuecomment-235408308)
2. ASAR 主要解决归档、路径和加载组织问题；它使应用文件进入虚拟只读文件系统，但不是“再压缩一次”的通用开关。读写、设置 `cwd`、执行二进制、原生模块加载等路径有明确限制或临时解包开销。[Electron ASAR 文档](https://github.com/electron/electron/blob/1cf98129e42ca3bff2b9ca13c78b65f10a156718/docs/tutorial/asar-archives.md#limitations-of-the-node-api)
3. 可靠的应用层减重手段是精确的打包文件集合：electron-builder 用 `files` 选择运行时文件，Forge 通过 Packager 的 `ignore` 和构建插件生成的产物边界排除源码、map、测试和开发依赖。排除规则必须以实际运行时依赖为准，误排会导致启动或功能失败。[electron-builder 配置迁移源码](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/packages/electron-builder/src/cli/migrate-schema.ts#L1-L120) [Electron Forge Vite 插件](https://github.com/electron/forge/blob/8a29c3fa537319799cd5901d90939ae8e0eae9cf/packages/plugin/vite/src/VitePlugin.ts#L1-L120)
4. 原生 `.node` 模块应按当前平台和架构只带需要的变体，并通常放到 `app.asar.unpacked` 或 equivalent 的 unpack 路径。把 `.node` 强行留在 ASAR 内不能消除运行时路径要求，可能触发临时解包、杀毒软件扫描和性能开销。[Electron ASAR 文档](https://github.com/electron/electron/blob/1cf98129e42ca3bff2b9ca13c78b65f10a156718/docs/tutorial/asar-archives.md#adding-unpacked-files-to-asar-archives) [electron-builder NSIS 源码](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/packages/app-builder-lib/src/targets/win/nsis/NsisTarget.ts#L100-L140)
5. “压缩格式”要按目标物区分：安装器压缩影响下载/安装包大小；ASAR 归档和安装器压缩是不同层次。electron-builder 的 NSIS 差分包需要 blockmap 和可被安装时解码的压缩过滤器；过高压缩、非兼容过滤器或手工混用旧 artifact 与新 metadata 会让差分更新失效或回退完整下载。[electron-builder NSIS 源码](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/packages/app-builder-lib/src/targets/win/nsis/NsisTarget.ts#L100-L140) [electron-builder 故障排查](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/website/docs/troubleshooting.md#delta-updates-appimage--nsis-web-fail)
6. 差分更新主要减少升级流量，不等于减少首次安装包。electron-builder 的实现按 blockmap 比较旧、新 artifact；文件布局变化会使更多 block 失效，更新量可能接近完整包，且缓存的旧 installer 与 blockmap 必须保持一致。[electron-builder 差分更新源码](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/packages/app-builder-lib/src/targets/differentialUpdateInfoBuilder.ts#L1-L180) [electron-builder 维护变更](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/.changeset/stale-blockmap-cache.md)
7. 平台差异是真实体积差异来源：Electron 运行时、平台辅助进程、签名结构、安装器格式和架构不同；macOS 的 framework 目录还依赖符号链接正确保留。跨平台复制文件或重新压缩时不保留 symlink，会把同一文件重复写入，造成虚假的巨大体积。[Electron 维护者讨论](https://github.com/electron/electron/issues/2003#issuecomment-137820386) [Electron 维护者讨论](https://github.com/electron/electron/issues/2003#issuecomment-138690977)
## 固定成本：能减什么，不能减什么

Electron 官方维护者对“把 Electron framework 再裁小”的回答是：`That's the expected size, there is no way to make it smaller.` 该评论针对早期版本，但它直接说明标准 Electron 分发物的运行时成本不是应用配置项。[issue #2003 评论](https://github.com/electron/electron/issues/2003#issuecomment-113404825)

> That's the expected size, there is no way to make it smaller.

维护者后续说明，Electron 集成了 Chromium、Node.js、V8 等组件，并且做了大量 patch；把它们拆成系统共享组件会破坏稳定性和独立运行能力。[issue #2003 评论](https://github.com/electron/electron/issues/2003#issuecomment-235408308)

> There is only so much you can take out of Chromium, Node.js, V8, etc and still have a working product. Unfortunately since everything is patched in order to work it isn't as easy as making it use standalone versions of each to cut down on the size.

因此，删除未使用的业务依赖、开发文件和错误平台二进制是有效边界；删除 Electron framework 内部组件或依赖用户机器预装 Electron 则不是标准、可靠的减包手段。后一句是基于维护者讨论的工程推论，不能当作一个可配置的 Electron API。

## ASAR：归档收益与运行时代价

Electron 官方文档把 ASAR 定义为面向 Electron 的简单归档格式，并列出它的实际收益：缓解 Windows 长路径问题、加快 `require`，以及防止源代码被随手查看。[ASAR 文档](https://github.com/electron/electron/blob/1cf98129e42ca3bff2b9ca13c78b65f10a156718/docs/tutorial/asar-archives.md#using-asar-archives)

> By bundling the app we can mitigate issues around long path names on Windows, speed up `require` and conceal your source code from cursory inspection.

ASAR 中的文件通过虚拟文件系统读取，但 archive 是只读的；不能把 archive 内目录作为工作目录。对 `child_process.execFile`、`execFileSync` 和 `process.dlopen`，Electron 可能把文件解到临时目录后再交给底层系统调用。[ASAR 文档](https://github.com/electron/electron/blob/1cf98129e42ca3bff2b9ca13c78b65f10a156718/docs/tutorial/asar-archives.md#limitations-of-the-node-api)

> The archives can not be modified so all Node APIs that can modify files will not work with ASAR archives.

> For APIs that rely on passing the real file path to underlying system calls, Electron will extract the needed file into a temporary file and pass the path of the temporary file to the APIs to make them work. This adds a little overhead for those APIs.

把 `.node` 预先 unpack 可以避免上述运行时解包；代价是必须随应用同时携带 `app.asar.unpacked` 目录。[ASAR 文档](https://github.com/electron/electron/blob/1cf98129e42ca3bff2b9ca13c78b65f10a156718/docs/tutorial/asar-archives.md#adding-unpacked-files-to-asar-archives)

> As a workaround, you can leave various files unpacked using the `--unpack` option.

> It contains the unpacked files and should be shipped together with the `app.asar` archive.

## 打包排除：electron-builder 与 Electron Forge

electron-builder v27 的 schema 迁移源码明确把默认排除文件重新纳入的方式定义为显式 `files` glob；这说明 `files` 是控制应用内容边界的主要入口，而不是依赖“猜哪些文件没用”。[源码](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/packages/app-builder-lib/src/util/config/legacyOptions.ts#L1-L80)

> To keep a default-excluded file, name it concretely in a `files` glob instead — e.g. `"files": ["**/*", "**/*.obj"]`.

v27 同时把 `asarUnpack` 合并到 `asar.unpack`，并在 `asar: false` 时警告 unpack 设置没有意义；因此“开了 unpack 就会自动减包”是错误理解，unpack 只改变文件位置和运行时访问方式。[迁移源码](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/packages/electron-builder/src/cli/migrate-schema-programmatic.ts#L1-L90)

> `asar: false` disables packaging entirely; remove the unpack keys or enable asar manually.

Electron Forge 的 Vite 插件在构建后给 `packagerConfig.ignore` 设置过滤函数；Forge 的核心 package API 会把 `forgeConfig.packagerConfig` 传给 Packager。两处源码证明 Forge 的减包边界来自 Packager 配置和构建插件产物，而不是 Maker 自己神奇地删除依赖。[Vite 插件](https://github.com/electron/forge/blob/8a29c3fa537319799cd5901d90939ae8e0eae9cf/packages/plugin/vite/src/VitePlugin.ts#L1-L120) [核心 package API](https://github.com/electron/forge/blob/8a29c3fa537319799cd5901d90939ae8e0eae9cf/packages/api/core/src/api/package.ts#L1-L90)

> forgeConfig.packagerConfig.ignore = (file: string) => {

> ...

> ...forgeConfig.packagerConfig,

Forge 模板默认启用 `packagerConfig.asar: true`；这是推荐的应用归档配置，但是否减小最终安装器仍取决于应用文件能否被归档器和外层安装器有效压缩。[Forge Vite 模板](https://github.com/electron/forge/blob/8a29c3fa537319799cd5901d90939ae8e0eae9cf/packages/template/vite/tmpl/forge.config.js#L1-L40)

> packagerConfig: {
>   asar: true,
> },

## 原生模块：平台选择与不可省略的文件

ASAR 文档明确指出 `process.dlopen` 用于 native module 的 `require`，并列入会额外解包的 API；因此 `.node` 需要专门处理。[ASAR 文档](https://github.com/electron/electron/blob/1cf98129e42ca3bff2b9ca13c78b65f10a156718/docs/tutorial/asar-archives.md#extra-unpacking-on-some-apis)

> `process.dlopen` - Used by `require` on native modules

electron-builder 的 NSIS 代码把构建压缩选项传给 archive，并强制使用安装时可解码的格式；源码注释说明现代 7za 可能使用安装器无法解码的 CPU branch converter，这会让主 exe 和 native binary 在安装包中丢失。[NSIS 源码](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/packages/app-builder-lib/src/targets/win/nsis/NsisTarget.ts#L110-L132)

> The install-time Nsis7z extractor only decodes plain LZMA2/Copy and single-stream BCJ — not the CPU branch converters modern 7za applies to executables ... which it silently skips, dropping the main exe and every native binary from the install.

可靠做法是：构建阶段只把当前 `platform`/`arch` 的 native binary 放进应用；需要真实路径的 `.node` 通过 `asar.unpack` 或 Forge/Packager 等价选项放到 archive 外。代价是每个平台、每个架构都必须分别验证，universal 构建还要检查两套 native binary 是否都被正确装入。

## 压缩格式、首次下载与差分更新

electron-builder 的 NSIS 目标在启用差分感知时使用 blockmap；非差分或显式 zip 路径则使用 zip。代码同时把 `packager.compression` 传入 archive，但会约束安装时可解码的过滤器。[NSIS 源码](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/packages/app-builder-lib/src/targets/win/nsis/NsisTarget.ts#L105-L142)

> const format = !isBuildDifferentialAware && options.useZip ? "zip" : "7z"

> compression: packager.compression,

官方故障排查说明，AppImage delta 使用内嵌 blockmap；NSIS differential package 则要求 `nsis.differentialPackage` 为 true。artifact 与 `.yml` metadata 还必须来自同一次构建，否则校验会失败。[electron-builder 故障排查](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/website/docs/troubleshooting.md#delta-updates-appimage--nsis-web-fail)

> For NSIS differential packages, `nsis.differentialPackage` must be `true`.

差分算法以 block 为单位；源码注释明确指出，文件在一个位置发生变化时，整个 block 会失效，更新大小可能接近 dictionary size。因此把大文件频繁改写、改变归档布局或重新生成大量 bundle，会削弱差分收益。[差分更新源码](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/packages/app-builder-lib/src/targets/differentialUpdateInfoBuilder.ts#L1-L180)

> if file changed in one place, all block is invalidated (and update size approximately equals to dict size)

维护变更记录了旧 installer 与旧 blockmap 不一致会污染下一次差分下载，并导致 sha512 mismatch 后回退完整下载；这说明差分更新要配套验证缓存、发布 metadata 和 artifact，而不是只打开一个开关。[electron-builder 维护变更](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/.changeset/stale-blockmap-cache.md)

> A download round that did not produce a new blockmap ... now removes the cached `current.blockmap` instead of leaving a stale one next to the freshly cached file ... and surfaced as a generic sha512 checksum mismatch before falling back to a full download.

## 平台差异与无效做法

macOS framework 目录含符号链接。Electron issue #2003 的维护者说明 macOS 压缩后的大小应与其他平台相近；该讨论中的复现者随后确认，不保留 symlink 会让体积从约 110 MB 降到约 45 MB。[维护者评论](https://github.com/electron/electron/issues/2003#issuecomment-137820386) [复现与修复评论](https://github.com/electron/electron/issues/2003#issuecomment-138690977)

> OS X compressed is similarly sized to other platforms which probably means that the app you're using to measure sizes is perhaps misinterpreting symlinks?

> I was finally able to look into this yesterday, and indeed my issue was caused by symlinks not being preserved. So my application size drastically shrunk from ~110Mbs, to ~45Mbs.

因此以下做法无效或有明确代价：

| 做法 | 判断 | 限制或代价 |
|---|---|---|
| 只把 ASAR 当作压缩器 | 不成立 | ASAR 是虚拟只读归档；外层安装器仍决定下载包压缩，部分 API 还会临时解包。 |
| 把所有 `.node` 留在 ASAR 内 | 不可靠 | `process.dlopen` 可能临时解包；原生模块需要真实路径时应 unpack。 |
| 只提高 7z/NSIS 压缩等级 | 有边界 | 安装器解码器只支持特定过滤器；不兼容过滤器可能导致安装包缺失 exe/native binary。 |
| 用差分更新解决首次安装包过大 | 不成立 | 差分只影响升级流量；首次安装仍需完整 artifact。 |
| 让用户机器共享一个 Electron 运行时 | 当前不支持 | 维护者明确拒绝该方向；会引入运行时版本、依赖和环境管理。 |
| 跨平台复制/压缩时忽略 symlink | 会制造虚假体积 | macOS framework 的链接可能被展开成重复实体文件。 |
| 把所有依赖都放进 `dependencies` | 高风险 | builder/packager 会把运行时依赖纳入最终应用；开发依赖若确实不在运行时应留在 devDependencies，但需用构建和启动验证证明。 |

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | Electron ASAR 文档与 Electron 源码提交 `1cf98129e42ca3bff2b9ca13c78b65f10a156718`；electron-builder v27 相关源码提交 `99b6c7f1efe761bbd3d0582e158a8f1705f652a0`；Electron Forge 源码提交 `8a29c3fa537319799cd5901d90939ae8e0eae9cf`。 |
| 作者或维护者本人的说法 | Electron issue #2003 中 zcbenz、baconbrad、ghost 等维护者/项目成员讨论了固定运行时成本、共享 Electron 运行时提议和 macOS symlink 体积问题。 |
| 同类方案 | electron-builder 与 Electron Forge 都把 ASAR/Packager 配置作为应用内容边界；electron-builder 进一步提供 NSIS/7z/blockmap，Forge 通过 Packager 与 Vite/Webpack 插件建立排除边界。 |
| issue / PR / 社区实践 | 查了 Electron issue #2003 及 electron-builder 的 blockmap 缓存修复 changeset；得到“symlink 展开会制造虚假体积”和“旧 blockmap 会造成差分校验失败并回退完整下载”的证据。 |
| 历史演变 | 查了 Electron issue #2003（2015-06-18 创建，后续至 2022-08-18 更新）和 electron-builder v26→v27 migration；确认 ASAR 配置键在 v27 归并到 `asar.unpack`，旧键不应作为新配置依据。 |

## 对本项目的影响

这份调研不产生 JAI 代码改动。对 JAI Desktop 的可靠优先级是：先用构建产物统计确认 Electron runtime、应用文件、native binary 和平台资源各自占比；再收紧 `files`/`ignore` 边界，按平台架构排除不需要的源码、map、测试和 native 变体；随后验证 ASAR 与 `.node` unpack；最后再比较安装器压缩和差分更新的下载收益。

应把“安装包体积”和“升级下载量”作为两个指标分别记录。任何压缩等级调整都必须在对应平台安装、启动、加载 native module 和更新流程上验证；任何 macOS 自定义复制/压缩流程都必须保留 symlink。没有官方证据支持通过裁剪 Electron 内置 Chromium/Node/V8 来获得一个稳定、通用的标准 Electron 包。
