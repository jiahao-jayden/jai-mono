# Electron 包体积优化：社区实际坑与收益

核验日期：2026-09-12。Electron 文档固定在 v37.0.0；Electron v37 的文档文件 SHA 分别为 `bb7a80aa84a1d21f477a9132c8ccf6f03aa8d698`、`e86580ed49c20d98a2d4720d5952a593ac69d07a`、`1afa53d6a7df319c247fdeb107c3b483658411f0`。electron-builder 源码和文档固定在 commit `99b6c7f1efe761bbd3d0582e158a8f1705f652a0`；GitHub issue 使用编号、受影响版本和固定评论链接。这样可以把结论与后续文档或实现变化分开。

## 结论

1. 大型静态二进制同时写进 `files` 和 `asarUnpack` 会重复进入 `app.asar` 与 `app.asar.unpacked`；electron-builder 维护者给出的修复是改用 `extraResources`，或只用 `extraFiles`，不要把同一文件再列入 `files`。限制：只有确实需要从 `app.asar` 外部路径访问的内容才应外置；外置后必须按 `process.resourcesPath` 解析路径。 [维护者确认](https://github.com/electron-userland/electron-builder/issues/2290#issuecomment-401005093) [维护者确认](https://github.com/electron-userland/electron-builder/issues/2290#issuecomment-401031196)
2. `files` 是最直接的体积控制点：默认会包含应用目录中可打包内容，生产包应显式收窄到编译产物和运行时依赖；但过窄会造成运行时缺模块，electron-builder 26.3.x/26.3.4 的真实案例显示 workspace/native-module 收集失败后可能打出缺失 `node_modules` 的包。收益需要以“能启动、能加载每个生产依赖”为约束。 [Electron 维护者文档](https://github.com/electron/electron/blob/bb7a80aa84a1d21f477a9132c8ccf6f03aa8d698/docs/tutorial/performance.md#L49-L98) [可复现案例](https://github.com/electron-userland/electron-builder/issues/9423)
3. Electron Framework 本身是固定基线，不能靠 `asar` 或前端 tree-shaking 消掉；Electron 官方性能文档把依赖数量、加载资源和运行时 profile 作为首要测量对象。可操作收益来自减少额外依赖、移除无用资源、选择更小的 Electron 版本/架构组合，而不是期待把 Framework 当应用代码压缩。限制：升级 Electron 可能改变基线，必须记录下载包和最终安装包两个数字。 [官方文档](https://github.com/electron/electron/blob/bb7a80aa84a1d21f477a9132c8ccf6f03aa8d698/docs/tutorial/performance.md#L37-L47)
4. V8 snapshots 主要优化启动时间，不是可靠的磁盘体积手段；Electron v37 文档说明 snapshot 通过保存初始化 heap 避免重复初始化，且自定义 main-process snapshot 会牺牲一部分内置 Node startup snapshot 原本节省的启动时间。限制：snapshot 文件仍需随包发布，版本、架构和启用的 Electron fuse 必须匹配。 [官方文档](https://github.com/electron/electron/blob/1afa53d6a7df319c247fdeb107c3b483658411f0/docs/tutorial/fuses.md#L51-L64)
5. native modules 的主要坑是 ABI、平台和架构，不是简单的“把 `.node` 放进 asar”；Electron 官方要求针对 Electron ABI 重编译，且每次升级 Electron 通常都要 rebuild。限制：跨架构构建必须分别准备正确的二进制；错误的 workspace root 或依赖过滤会让构建成功但运行时缺模块。 [官方文档](https://github.com/electron/electron/blob/e86580ed49c20d98a2d4720d5952a593ac69d07a/docs/tutorial/using-native-node-modules.md#L1-L43) [维护者修复](https://github.com/electron-userland/electron-builder/commit/99b6c7f1efe761bbd3d0582e158a8f1705f652a0)
6. 增量更新减少的是“更新下载量”，不一定减少首装包；Windows NSIS differential package 和 AppImage blockmap 依赖正确的上一版本、同一构建元数据和发布文件配对。限制：portable 等目标不具备同样能力，manifest、blockmap 或文件名混搭会退化为失败或整包下载。 [electron-builder 文档](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/website/docs/troubleshooting.md#L1-L30) [可复现案例](https://github.com/electron-userland/electron-builder/issues/2499)
7. `compression: "maximum"` 的体积收益通常有限，维护者在当前配置类型中明确写的是“不会带来 noticeable size difference”，代价是增加构建时间；NSIS-Web 的真正收益是按架构下载对应包，避免一个安装器内捆绑所有架构。限制：压缩级别不能补救重复资源或错误的 `files`，应先做内容清单和重复文件审计。 [维护者文档/类型注释](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/packages/app-builder-lib/src/options/PlatformSpecificBuildOptions.ts#L1-L20) [维护者文档](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/website/docs/nsis.md#L1-L12)

## `asarUnpack`、`extraResources` 与重复文件

**维护者确认。** electron-builder issue #2290 报告的版本是 19.45.4，问题文件既出现在 `app.asar` 又出现在 `app.asar.unpacked`。维护者建议静态文件使用 `extraResources`，并进一步明确不要把它同时列在 `files`；若只是外部资源，`asarUnpack` 不需要再出现。 [issue 原文](https://github.com/electron-userland/electron-builder/issues/2290#L1-L35) [维护者回复](https://github.com/electron-userland/electron-builder/issues/2290#issuecomment-401005093) [维护者回复](https://github.com/electron-userland/electron-builder/issues/2290#issuecomment-401031196)

> It appears twice in the final package:
>
> * Contents/Resources/app.asar.unpacked/build/a-large-binary-file
> * Contents/Resources/app.asar/build/a-large-binary-file
>
> Since it is large, it also make the final distribution package large.

> Use `extraResources` instead of `asarUnpack` for static files.
>
> Do not specify in `files`. Use `extraResources` or `extraFiles`.
> `asarUnpack` is not required.

**可操作规则。** 可执行文件、ffmpeg、模型和其他必须由操作系统直接打开的内容，选择一个外置路径；普通 JS、JSON、CSS 和图片留在 `app.asar`。Electron 自身的 ASAR 文档也说明，`--unpack` 会生成并要求随包发布 `app.asar.unpacked`，因此它解决的是可访问性，不是去重压缩。 [Electron ASAR 文档](https://github.com/electron/electron/blob/fff9483bdcb5dbf5d1d4f2f35ad527ff5068e03d/docs/tutorial/asar-archives.md#L1-L30)

> After running the command, you will notice that a folder named `app.asar.unpacked`
> was created together with the `app.asar` file. It contains the unpacked files
> and should be shipped together with the `app.asar` archive.

**普通用户反馈。** 同一 issue 的用户反馈“exact same issue”并表示尝试解决但没有成功；这证明问题曾被重复遇到，但没有给出发生率或普遍性结论。 [普通反馈](https://github.com/electron-userland/electron-builder/issues/2290#issuecomment-401004583)

> Having the exact same issue. Been trying to resolve this for a while, with no real success.
> Did you find a workaround?

## `electron-builder files` 的收缩与反方

**维护者确认。** Electron v37 官方性能文档把“carelessly including modules”列为首项，并要求检查依赖大小、`require()` 加载资源和实际操作资源。它给出的基线不是“把 `node_modules` 全删掉”，而是先测量依赖树和加载成本。 [官方文档](https://github.com/electron/electron/blob/bb7a80aa84a1d21f477a9132c8ccf6f03aa8d698/docs/tutorial/performance.md#L49-L98)

> Before adding a Node.js module to your application, examine said module.
> How many dependencies does that module include?
> What kind of resources does it need to simply be called in a `require()` statement?
>
> When considering a module, we recommend that you check:
> 1. the size of dependencies included
> 2. the resources required to load (`require()`) it
> 3. the resources required to perform the action you're interested in

**可复现案例。** electron-builder issue #9423 使用 electron-builder 26.3.4、Electron 37.10.3、pnpm workspace 和 `better-sqlite3`。日志先显示 native module rebuild 成功，随后 node-module collector 报 `depCount=0`、`no node modules returned`；用户将回退点锁定在 26.3.2 与升级到 26.3.3 之间。 [案例日志](https://github.com/electron-userland/electron-builder/issues/9423#L1-L60)

> electron-builder Version: 26.3.4
>
> Electron Version: 37.10.3
>
> installing native dependencies  arch=x64
>
> node modules collection complete  packageName=any-listen depCount=0
>
> no node modules returned while searching directories

**反方。** `files` 过窄会把运行时必需文件删掉；先用构建产物清单和启动/核心流程 smoke test 证明每个生产依赖都在，再加排除规则。优化收益应记录“包内字节减少”和“冷启动/功能测试是否仍通过”两个维度。

## Electron Framework size 与 V8 snapshots

**维护者确认。** Electron 官方性能文档将真正可靠的优化路径定义为 profile、找到最耗资源部分并重复测量；它还明确建议检查依赖大小和加载成本。这个结论不支持把 Framework 本体视为可由应用层 `asar` 消除的对象。 [官方文档](https://github.com/electron/electron/blob/bb7a80aa84a1d21f477a9132c8ccf6f03aa8d698/docs/tutorial/performance.md#L37-L47)

> The most successful strategy for building a performant Electron app is to profile the running code, find the most resource-hungry piece of it, and to optimize it.
>
> When considering a module, we recommend that you check:
> 1. the size of dependencies included
> 2. the resources required to load (`require()`) it
> 3. the resources required to perform the action you're interested in

**可操作手段。** 记录每个平台、架构和 Electron 版本的三个数字：下载的 Electron zip、解压后的 Framework/运行时目录、最终安装器。只比较最终安装器会把应用内容、运行时、安装器压缩和多架构重复混在一起。

**V8 snapshot 的实际收益与限制。** Electron v37 fuse 文档说明 snapshots 是通过保存初始化 heap 来改善启动；同时，启用独立 browser snapshot 会改变 snapshot 文件选择，自定义 snapshot 还可能让 main process 失去内置 Node startup snapshot 的部分启动收益。 [官方文档](https://github.com/electron/electron/blob/1afa53d6a7df319c247fdeb107c3b483658411f0/docs/tutorial/fuses.md#L51-L64)

> V8 snapshots can be useful to improve app startup performance.
> V8 lets you take snapshots of initialized heaps and then load them back in to avoid the cost of initializing the heap.
>
> When the main process runs on a custom V8 snapshot ... Electron bootstraps the main process's Node.js environment from source instead of from its embedded Node.js startup snapshot,
> so that the objects in the custom snapshot are available to the main process.
> This costs part of the main-process startup time the embedded snapshot otherwise saves.

**普通用户反馈。** 本轮未把“Framework 太大”的论坛抱怨当作收益证据；没有带固定 Electron 版本、产物拆分和前后字节数的反馈，只能作为待验证线索，不能证明 Framework 可被压缩或替换。

## native modules

**维护者确认。** Electron v37 文档明确说明 Electron 与普通 Node.js 有不同 ABI，需要为 Electron 重编译；升级 Electron 后通常要重新 rebuild，并且目标平台和架构必须匹配。 [官方文档](https://github.com/electron/electron/blob/e86580ed49c20d98a2d4720d5952a593ac69d07a/docs/tutorial/using-native-node-modules.md#L1-L43)

> Native Node.js modules are supported by Electron, but since Electron has a different
> application binary interface (ABI) from a given Node.js binary ... the native
> modules you use will need to be recompiled for Electron.
>
> Make sure the native module is compatible with the target platform and
> architecture for your Electron app.
>
> After you upgrade Electron, you usually need to rebuild the modules.

**可复现案例。** electron-builder issue #9423 的 26.3.4/37.10.3 日志表明 rebuild `better-sqlite3` 可以显示成功，但依赖收集阶段仍可能得到 `depCount=0`；因此“rebuild 成功”不等于“最终包包含正确 native module”。 [案例](https://github.com/electron-userland/electron-builder/issues/9423#L1-L60)

**维护者修复。** electron-builder commit `99b6c7f1...` 描述了 Windows pnpm workspace root 丢失会让 `@electron/rebuild` 只搜索 app 目录，甚至在 cross-architecture 构建中带上错误架构的传递 native module；修复是向上查找 `pnpm-workspace.yaml` 并保留已定位的 root。 [固定 commit](https://github.com/electron-userland/electron-builder/commit/99b6c7f1efe761bbd3d0582e158a8f1705f652a0)

> `pwd` is a POSIX command: on Windows it is either missing ... or resolves to the Git-for-Windows binary ...
> Either way the root was lost and `@electron/rebuild` never reached native modules stored under the root `node_modules/.pnpm`.
>
> The located root must survive instead of collapsing to the app dir.
>
> cross-architecture builds ... shipped transitive native modules such as `keytar` for the wrong architecture.

**反方。** native module 通常不能通过 `files` 粗暴排除；必须保留目标架构 `.node` 及其运行时依赖，并在每个目标 OS/arch 上验证 `require()`。如果模块提供 Electron prebuild，应避免无谓的 `--build-from-source`，否则构建时间和产物来源都会变化。 [官方文档](https://github.com/electron/electron/blob/e86580ed49c20d98a2d4720d5952a593ac69d07a/docs/tutorial/using-native-node-modules.md#L150-L178)

## 增量更新、blockmap 与首装包

**维护者确认。** electron-builder 当前 troubleshooting 文档把 AppImage delta update 与 NSIS differential package 分开说明：AppImage 将 blockmap 嵌入 AppImage，NSIS 需要 `nsis.differentialPackage: true`。这降低更新下载量的前提是发布端保留匹配的旧包和 manifest。 [固定文档](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/website/docs/troubleshooting.md#L1-L30)

> For AppImage delta updates, electron-builder embeds a blockmap directly in the AppImage binary — no separate file needs to be published.
>
> For NSIS differential packages, `nsis.differentialPackage` must be `true`.

**可复现案例。** electron-builder issue #2499 使用 electron-builder 19.36.0、electron-updater 2.11.0、Windows x86/x64 和 `nsis-web`；用户发布了 `latest.yml` 与两个 `.nsis.7z`，但更新下载 URL 变成 `undefined` 并返回 404。该案例说明“生成了 blockmap 字段”不等于更新链路已正确配对。 [案例](https://github.com/electron-userland/electron-builder/issues/2499#L1-L55)

> electron-builder : 19.36.0 , electron-updater: 2.11.0
>
> Target: Windows x86 & x64
>
> Then downloading and installing ... works fine.
>
> When I publish a update ... I get the following error.
>
> `Cannot download "https://example.com/installers/dev/win/undefined", status 404`

**普通用户反馈。** 本轮没有把“更新很快”或“delta 很小”的无版本截图当作收益证据；应该在固定旧/新版本、同一架构、同一发布端下记录整包字节、delta 字节和失败回退率。

**反方。** 增量更新不改变首装下载量；如果包内大文件每版都移动位置或被重新打包，blockmap 仍可能产生较大的 delta。portable 目标也不能直接套用 NSIS differential package 的假设。

## compression、7z、zip 与 NSIS-Web

**维护者确认。** electron-builder 的当前配置类型注释明确说明 `store` 适合快速测试，`maximum` 不会带来明显体积差异但会增加构建时间，默认是 `normal`。 [固定源码](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/packages/app-builder-lib/src/options/PlatformSpecificBuildOptions.ts#L1-L20)

> The compression level. If you want to rapidly test build, `store` can reduce build time significantly.
> `maximum` doesn't lead to noticeable size difference, but increase build time.
> @default normal

**可操作手段。** 日常 CI/本地验证使用 `normal`；只有发布构建经过实测确认字节下降且时间可接受时才切 `maximum`。7z/NSIS 的收益应按“同一文件集、同一架构、同一安装器目标”比较；zip 不能与 NSIS 7z 结果直接横比。

**NSIS-Web 的实际收益。** electron-builder 文档说明 `nsis-web` 让安装器按 OS 架构下载对应 package file，因此不会把所有架构的 package files 一起塞入安装器；文档把它定位为大型应用的解决方案。 [固定文档](https://github.com/electron-userland/electron-builder/blob/99b6c7f1efe761bbd3d0582e158a8f1705f652a0/website/docs/nsis.md#L1-L12)

> Web Installer automatically detects OS architecture and downloads corresponding package file.
> So, the user doesn't need to guess what installer to download and at the same time you don't bundle package files for all architectures in one installer.
>
> It doesn't matter for common Electron application ... but if your application is huge, Web Installer is a solution.

**普通用户反馈。** issue #2499 的用户配置了 `compression: "maximum"`、`nsis-web`、`asarUnpack` 和 `extraResources`，但实际失败点是更新元数据中的 `undefined` URL；这不能证明压缩级别或 NSIS-Web 自身降低了首装/更新体积。 [普通案例反馈](https://github.com/electron-userland/electron-builder/issues/2499#L1-L55)

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | Electron v37.0.0 的 performance、ASAR、native modules、fuses 文档；electron-builder commit `99b6c7f1efe761bbd3d0582e158a8f1705f652a0` 的配置类型、troubleshooting 和 native-module 修复。 |
| 作者或维护者本人的说法 | electron-builder 维护者 develar 在 issue #2290 中明确建议 `extraResources` / `extraFiles`；Electron 官方维护文档解释依赖测量、native ABI、V8 snapshot 的启动时间取舍。 |
| 同类方案 | Electron Forge 在 Electron native-module 文档中被点名会自动运行 `@electron/rebuild`；electron-builder 提供 `files`、`extraResources`、`asarUnpack`、NSIS-Web 和 differential package；两者都把 native rebuild 作为发行流程的一部分，但资源布局和更新目标不同。 |
| issue / PR / 社区实践 | 查了 electron-builder #2290、#2499、#9423，以及维护者修复 commit `99b6c7f1...`；分别覆盖重复打包、更新元数据失配、workspace/native-module 收集失败。普通反馈单独标注，未用于推导发生率。 |
| 历史演变 | 对照了 electron-builder 19.36.0/19.45.4、26.3.2/26.3.4、Electron 37.10.3 的案例；可见配置语义和 native-module 收集会随版本变化，因此结论均钉版本，未把旧 issue 的行为外推到当前版本。 |

## 对本项目的影响

1. 先做产物清单：按文件路径统计 `app.asar`、`app.asar.unpacked`、`Resources`、Framework 和每个架构的重复字节；重复资源优先改布局，压缩级别放后面。
2. 资源分类只保留三种选择：普通运行时代码进 `app.asar`；需要外部执行/加载的二进制进 `extraResources`；确实需要额外安装位置的内容才用 `extraFiles`。同一文件不要再出现在 `files` 与 `asarUnpack`。
3. `files` 收缩必须配合生产依赖 smoke test；native module 额外验证每个 OS/arch 的 ABI、文件存在和 `require()`。
4. Framework size 作为 Electron 版本/架构基线单独记录；V8 snapshot 只按启动时间评估，不能当作包体积优化承诺。
5. 更新优化单独看首装与更新：NSIS-Web 影响首装架构选择，differential/blockmap 影响更新下载；发布端必须把旧版、最新版、manifest 和 blockmap 作为一组验证。
6. `compression: "maximum"` 暂不作为默认优化手段；只有在固定产物上测出可重复的字节收益时才接受额外构建时间。

### 待验证

- 具体 Electron Framework 在不同版本、OS、架构上的字节拆分：本轮没有读取 JAI 本地实现，也没有对目标项目做源码或产物测量。
- V8 snapshot 对实际应用启动时间和文件大小的净变化：官方资料证明启动语义与限制，但没有提供通用包体积收益数字。
- `files` 规则在目标项目中的最小闭包：需用目标项目自己的构建产物和 smoke test 验证，不能由社区案例替代。
