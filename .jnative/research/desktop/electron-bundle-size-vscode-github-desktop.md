# Electron 安装包体积：VS Code/VSCodium 与 GitHub Desktop

核验日期：2026-09-12。源码固定在 VS Code commit `a8f49160195d9e967d2d51e8544dc895207518e7`、VSCodium commit `5a73682ca091082675b10c9dc3f348c1d824d94f`、GitHub Desktop `development` commit `8eb43b9bc99d866f89b8ca8f8043bdd80ea0a2a2`。这些 SHA 用来阻止后续主分支变化混入结论；GitHub Desktop 的 `app/package.json` 同时固定为 `3.6.6-beta1`。

## 结论

1. VS Code 的主要体积控制点是构建期的选择性打包：应用代码进入 `app.asar`，生产依赖进入独立的 `node_modules.asar`，并按 glob 规则跳过、解包或复制特定文件；这比把完整 `node_modules` 原样放进 Electron 应用目录更可控。成立条件是运行时能适配 ASAR；需要直接访问磁盘的原生模块和子进程仍必须放到 `.asar.unpacked`。证据见下方“VS Code：ASAR 与依赖布局”[`源码`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/bootstrap-node.ts)。
2. VS Code 通过内置扩展的目标平台过滤减少产物内容：声明了 `platforms` 且不匹配当前平台的扩展直接跳过；扩展还可使用平台专属 VSIX。这个优化只减少可选扩展和其依赖，不能压缩 Electron runtime、本体代码或必须随产品发布的扩展。证据见下方“VS Code：内置扩展裁剪”[`源码`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/build/lib/builtInExtensions.ts)。
3. VS Code 的 macOS universal 产物不是免费合并：构建先准备 x64 与 arm64 两套 app，再对平台专属目录交叉复制、跳过比较并标记 arch-specific 文件。它避免发布两个安装包，但可能把两套原生二进制都带进一个 universal 包；追求最小下载量时，单架构产物更有利。证据见下方“VS Code：平台产物”[`源码`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/build/darwin/create-universal-app.ts)。
4. VSCodium 的可复用体积策略主要来自“删功能输入”而不是另造打包器：其 patch 移除了 Copilot 扩展、相关 SDK 依赖、平台包、ripgrep shim 和构建步骤，同时沿用 VS Code 的打包流程。这个策略只有在产品明确不需要被移除的功能时成立；移除扩展会改变发行版能力和兼容范围。证据见下方“VSCodium：依赖裁剪”[`patch`](https://github.com/VSCodium/vscodium/blob/5a73682ca091082675b10c9dc3f348c1d824d94f/patches/53-ext-copilot-remove-it.patch)。
5. GitHub Desktop 采用 `@electron/packager`，但当前固定源码明确设置 `asar: false`，并写下“以后可能启用”的 TODO；它靠手工复制依赖、静态资源和自定义 ignore/prune 规则控制目录。这个做法减少了 ASAR 兼容问题，却放弃了 ASAR 对目录结构和分发内容的集中封装，不能直接作为“开启 ASAR 即可减小体积”的证据。证据见下方“GitHub Desktop：打包与限制”[`源码`](https://github.com/desktop/desktop/blob/8eb43b9bc99d866f89b8ca8f8043bdd80ea0a2a2/script/build.ts)。
6. GitHub Desktop 的平台产物受产品流程限制：构建阶段的 `packageApp` 只接受 `win32`、`darwin`、`linux` 三种平台值，但最终 `script/package.ts` 只对 macOS 和 Windows 生成分发物，其他平台直接退出；Windows 还会额外生成 Squirrel.Windows 安装包，并可生成 delta 包。体积比较必须区分 app 目录、zip、安装器和 delta，而不能只比较一个“Electron 包大小”。证据见下方“GitHub Desktop：平台产物”[`源码`](https://github.com/desktop/desktop/blob/8eb43b9bc99d866f89b8ca8f8043bdd80ea0a2a2/script/package.ts)。

## 统一维度对比

| 维度 | VS Code | VSCodium | GitHub Desktop |
|---|---|---|---|
| 打包工具 | 自定义 gulp/`createAsar` 以及平台构建脚本，源码见 [`build/lib/asar.ts`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/build/lib/asar.ts) | 复用上游 VS Code 构建；patch 拆出 prepack/packing，并移除私有功能，见 [`50-build-improve-gulp-tasks.patch`](https://github.com/VSCodium/vscodium/blob/5a73682ca091082675b10c9dc3f348c1d824d94f/patches/50-build-improve-gulp-tasks.patch) | `@electron/packager` + `electron-winstaller`，见 [`build.ts`](https://github.com/desktop/desktop/blob/8eb43b9bc99d866f89b8ca8f8043bdd80ea0a2a2/script/build.ts) 与 [`package.ts`](https://github.com/desktop/desktop/blob/8eb43b9bc99d866f89b8ca8f8043bdd80ea0a2a2/script/package.ts) |
| asar / 资源裁剪 | `node_modules.asar`、`.unpacked`、skip/unpack/duplicate glob | 沿用上游 ASAR，并删除 Copilot 相关输入 | 当前 `asar: false`；依赖和资源由脚本复制、ignore、手工 prune |
| 依赖裁剪 | 平台扩展过滤、生产依赖单独归档、原生模块解包 | 删除 Copilot runtime/SDK/扩展及其锁文件输入 | `copyDependencies()` 后由脚本执行自定义清理；`prune: false`，因为“自己 prune” |
| 平台产物 | x64/arm64 分包与 macOS universal 合并；平台专属文件保留 | `VSCODE_ARCH` 选择目标架构，发行脚本按 OS 组织资产 | macOS zip、Windows Squirrel 安装物；Linux 在最终 package 脚本中不产包 |
| 实际限制 | ASAR 不适合需要真实磁盘路径或原生加载的文件；universal 会携带多架构内容 | 删除功能会改变发行版能力；仍受上游 Electron/扩展和原生模块约束 | 不使用 ASAR；最终分发体积还受安装器、签名、delta 和平台工具影响 |

## VS Code：ASAR 与依赖布局

**发现：生产依赖被集中放入 `node_modules.asar`，并通过启动时的解析钩子保持 CommonJS 查找行为。** 这让构建脚本可以把依赖作为独立归档处理，同时保留少量真实目录用于运行时特殊文件。[`src/bootstrap-node.ts`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/src/bootstrap-node.ts)

```ts
/**
 * Add ASAR support to Node's CommonJS module resolution.
 *
 * Production builds bundle our `node_modules` into a `node_modules.asar`
 * archive that sits next to the (now mostly empty) `node_modules` folder.
 * Node does not look into `.asar` archives on its own, so we splice the
 * archive into the lookup paths right before the real `node_modules` folder.
```

**发现：VS Code 的 ASAR 生成器把文件分成 skip、duplicate、unpack 和 archive 四类。** 这提供了比“整个目录压缩”更细的体积控制面：可以跳过不应发布的文件，把需要磁盘路径的文件复制到 `.unpacked`，并对特殊加载路径保留副本。[`build/lib/asar.ts`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/build/lib/asar.ts)

```ts
const shouldUnpackFile = (file: VinylFile): boolean => {
  for (let i = 0; i < unpackGlobs.length; i++) {
    if (minimatch(file.relative, unpackGlobs[i])) return true;
  }
  return false;
};

const shouldSkipFile = (file: VinylFile): boolean => {
  for (const skipGlob of skipGlobs) {
    if (minimatch(file.relative, skipGlob)) return true;
```

**不成立条件：** 如果某依赖通过 `require.resolve`、子进程启动、原生 addon 加载或自定位逻辑要求真实文件路径，仅把它放进 ASAR 会失败；VS Code 因而保留 `node_modules.asar.unpacked` 这一边界。这个限制是源码中明确的运行时约束，不能把所有依赖都当成可归档的 JavaScript。

## VS Code：内置扩展裁剪

**发现：内置扩展按目标平台过滤，平台不匹配的扩展返回空流，不进入构建结果。** 这是一种直接减少资源和依赖输入的构建期裁剪。[`build/lib/builtInExtensions.ts`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/build/lib/builtInExtensions.ts)

```ts
function syncExtension(extension: IExtensionDefinition, controlState: 'disabled' | 'marketplace'): Stream {
  if (extension.platforms) {
    const platforms = new Set(extension.platforms);

    if (!platforms.has(process.platform)) {
      log(ansiColors.gray('[skip]'), `${extension.name}@${extension.version}: Platform '${process.platform}' not supported: [${extension.platforms}]`, ansiColors.green('✔︎'));
      return es.readArray([]);
    }
  }

  switch (controlState) {
```

**发现：平台专属扩展从对应的发布资产下载，而不是回退到通用 Marketplace 包。** 这使产物能避免携带与目标平台无关的扩展文件，但要求每个已声明平台都有对应资产和校验信息。[`build/lib/builtInExtensions.ts`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/build/lib/builtInExtensions.ts)

```ts
if (extension.vsix) {
  input = ext.fromVsix(path.join(root, extension.vsix), extension);
} else if (extension.platformSpecific) {
  const asset = resolvePlatformSpecificAsset(extension);
  if (!asset) {
    return es.readArray([]);
  }
  input = ext.fromGithub(extension, { asset, latest: isInsiders() });
} else if (productjson.extensionsGallery?.serviceUrl) {
```

**不成立条件：** 这只对可按平台拆开的扩展有效。扩展没有平台声明、产品必须内置它，或已知目标缺少平台资产时，不能靠该规则减少体积；源码对“已知目标但没有资产”会抛错，而不是静默生成不完整产品。

## VS Code：平台产物

**发现：macOS universal 构建显式处理两个架构的目录树和原生文件。** 构建先定位 x64/arm64 app，再合并 ASAR，并用 `singleArchFiles`、`x64ArchFiles` 与比较跳过规则标记架构差异。[`build/darwin/create-universal-app.ts`](https://github.com/microsoft/vscode/blob/a8f49160195d9e967d2d51e8544dc895207518e7/build/darwin/create-universal-app.ts)

```ts
const x64AppPath = path.join(buildDir, 'VSCode-darwin-x64', appName);
const arm64AppPath = path.join(buildDir, 'VSCode-darwin-arm64', appName);
const asarRelativePath = path.join('Contents', 'Resources', 'app', 'node_modules.asar');
const outAppPath = path.join(buildDir, `VSCode-darwin-${arch}`, appName);

// Copilot SDK ships platform-specific native binaries that npm only installs
// for the host architecture. The universal app merger requires both builds to
// have identical file trees, so we cross-copy each missing directory from the
// other build. The binaries are then excluded from comparison (filesToSkip)
// and the x64 binary is tagged as arch-specific (x64ArchFiles) so the merger
// keeps both.
```

**不成立条件：** universal 包解决的是一次安装覆盖两种架构，不能保证下载体积最小。只要某依赖有 x64 与 arm64 原生二进制，合并产物就需要保留两套或等价的架构专属文件；要追求最小分发体积，应分别发布架构包并比较用户覆盖率与维护成本。

## VSCodium：依赖裁剪

**发现：VSCodium 通过 patch 移除 Copilot 扩展、SDK、平台包、构建步骤和相关锁文件依赖。** 这是“从产品输入端删除内容”的体积策略，通常比在最终目录中删除文件更容易保持依赖图一致。[`53-ext-copilot-remove-it.patch`](https://github.com/VSCodium/vscodium/blob/5a73682ca091082675b10c9dc3f348c1d824d94f/patches/53-ext-copilot-remove-it.patch)

```diff
-import { compileNonNativeExtensionsBuildTask, compileNativeExtensionsBuildTask, compileAllExtensionsBuildTask, compileExtensionMediaBuildTask, cleanExtensionsBuildTask, compileCopilotExtensionBuildTask } from './gulpfile.extensions.ts';
+import { compileNonNativeExtensionsBuildTask, compileNativeExtensionsBuildTask, compileAllExtensionsBuildTask, compileExtensionMediaBuildTask, cleanExtensionsBuildTask } from './gulpfile.extensions.ts';
-import { ensureCopilotPlatformPackage, getCopilotExcludeFilter, getCopilotRuntimePrebuildFiles, getCopilotTgrepExcludeFilter, getMxcExcludeFilter, getRipgrepExcludeFilter, prepareBuiltInCopilotRipgrepShim } from './lib/copilot.ts';
 import { ensureOSProxyResolverPlatformPackage, getOSProxyResolverExcludeFilter, getOSProxyResolverPlatformFiles } from './lib/osProxyResolver.ts';
@@
-		ensureCopilotPlatformPackage(platform, arch);
-		const copilotRuntimePrebuilds = gulp.src(getCopilotRuntimePrebuildFiles(platform, arch), { base: '.', dot: true, allowEmpty: true });
-		const deps = es.merge(cleanedDeps, copilotRuntimePrebuilds, osProxyResolverPlatformPackage)
```

**发现：VSCodium 还移除了 Copilot 相关的顶层依赖声明。** 这表明体积收益不只来自最终资源目录，也来自不安装这些包及其传递依赖。[`53-ext-copilot-remove-it.patch`](https://github.com/VSCodium/vscodium/blob/5a73682ca091082675b10c9dc3f348c1d824d94f)

```diff
       "dependencies": {
-        "@anthropic-ai/sdk": "^0.82.0",
-        "@github/copilot": "1.0.81-0",
-        "@github/copilot-sdk": "1.0.11",
         "@microsoft/1ds-core-js": "^3.2.13",
@@
-    "node_modules/@anthropic-ai/sdk": {
-      "version": "0.82.0",
-      "resolved": "https://registry.npmjs.org/@anthropic-ai/sdk/-/sdk-0.82.0.tgz",
-      "integrity": "sha512-xdHTjL1GlUlDugHq/I47qdOKp/ROPvuHl7ROJCgUQigbvPu7asf9KcAcU1EqdrP2LuVhEKaTs7Z+ShpZDRzHdQ==",
-      "license": "MIT",
```

**不成立条件：** 只有在产品不需要这些能力时，删除 Copilot 才是可接受的体积优化；对需要 AI、认证或相关代理能力的发行版，照搬 patch 会造成产品功能缺失。VSCodium 也没有证明“移除一个特性后应当删除所有相似依赖”，每一项仍需从实际入口和构建产物验证。

## GitHub Desktop：打包与限制

**发现：GitHub Desktop 使用 `@electron/packager`，但当前源码明确关闭 ASAR，并设置 `prune: false`，注释说明依赖由项目自己清理。** 这说明该项目把可控的资源复制和清理放在 packager 之前/周围，而不是依赖 packager 的默认裁剪。[`script/build.ts`](https://github.com/desktop/desktop/blob/8eb43b9bc99d866f89b8ca8f8043bdd80ea0a2a2/script/build.ts)

```ts
return packager({
  name: getExecutableName(),
  platform: toPackagePlatform(process.platform),
  arch: toPackageArch(process.env.TARGET_ARCH),
  asar: false, // TODO: Probably wanna enable this down the road.
  out: getDistRoot(),
  extraResource: [assetsCarPath],
  dir: outRoot,
  overwrite: true,
  tmpdir: false,
  derefSymlinks: false,
  prune: false, // We'll prune them ourselves below.
```

**发现：GitHub Desktop 的构建流程先复制依赖、emoji、静态资源和 license 元数据，再决定是否调用 packager。** E2E 还支持 `DESKTOP_SKIP_PACKAGE=1`，说明“编译目录”和“可分发包”是两个独立状态，体积测量应针对最终产物阶段。[`script/build.ts`](https://github.com/desktop/desktop/blob/8eb43b9bc99d866f89b8ca8f8043bdd80ea0a2a2)

```ts
console.log('Copying dependencies…')
copyDependencies()

console.log('Packaging emoji…')
copyEmoji()

console.log('Copying static resources…')
copyStaticResources()

console.log('Parsing license metadata…')
generateLicenseMetadata(outRoot)

moveAnalysisFiles()
```

**发现：最终分发阶段只实现 macOS zip 和 Windows 安装器；其他 host 平台直接报错退出。** Windows 还可生成 full/delta NuGet 包，且通过重命名把架构写入文件名。[`script/package.ts`](https://github.com/desktop/desktop/blob/8eb43b9bc99d866f89b8ca8f8043bdd80ea0a2a2/script/package.ts)

```ts
if (process.platform === 'darwin') {
  packageOSX()
} else if (process.platform === 'win32') {
  packageWindows()
} else {
  console.error(`I don't know how to package for ${process.platform} :(`)
  process.exit(1)
}

console.log('Writing bundle size info…')
writeFileSync(
  path.join(getDistRoot(), 'bundle-size.json'),
```

**不成立条件：** 不能把 GitHub Desktop 的 `asar: false` 解读成 ASAR 没有体积价值。该源码只证明这个版本选择了兼容性和现有清理流程；它没有提供“关闭 ASAR 更小”的测量，也没有证明其手工 prune 规则适合其他 Electron 应用。Windows 安装器、签名和 delta 还会改变最终下载体积。

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 查阅并固定了 VS Code `build/lib/asar.ts`、`src/bootstrap-node.ts`、`build/lib/builtInExtensions.ts`、`build/darwin/create-universal-app.ts`；VSCodium `dev/build.sh`、`get_repo.sh` 与两个裁剪 patch；GitHub Desktop `script/build.ts`、`script/package.ts`、`app/package.json`。 |
| 作者或维护者本人的说法 | 未找到足以支撑体积机制的独立作者博客、演讲或维护者长文；本笔记不把社区说法当作证据，源码注释只作为源码证据的一部分。 |
| 同类方案 | 对比了 VS Code、VSCodium、GitHub Desktop 三个开源 Electron 项目，统一比较打包工具、ASAR/资源裁剪、依赖裁剪、平台产物和实际限制。 |
| issue / PR / 社区实践 | 未将 issue 作为核心证据；本题的关键行为均能由固定 SHA 的构建源码直接复核，社区材料不会改变这些源码事实。 |
| 历史演变 | 仅记录当前固定快照中的演变信号：GitHub Desktop 的 `asar: false` TODO、VSCodium 的 patch 删除上游功能输入、VS Code 当前的 `node_modules.asar` 与 universal 合并流程；未据此推断未查到的历史版本收益。 |

## 对本项目的影响

优先级最高的是建立“最终分发物体积”而不是只看 `out/` 目录：分别记录 app 目录、ASAR、`.asar.unpacked`、平台原生二进制、安装器和 delta 的字节数。VS Code 的做法说明，最有效的通用手段是先建立可审计的文件分类，再把能进 ASAR 的 JavaScript/资源归档，把原生 addon、会被子进程执行的二进制和需要真实路径的文件单独解包。

可直接复用的策略有三项：按平台过滤资源和内置扩展；从产品依赖图删除明确不需要的功能，而不是只在产物末尾删除目录；对 universal 构建单独核算双架构原生文件。GitHub Desktop 提醒需要保留“不使用 ASAR”的对照构建，测量启动、原生模块、更新和安装器体积后再决定是否启用。

本调研没有分析 JAI 本地代码，也没有实测上述项目的安装包字节数；因此“能减少多少 MB”仍属于待验证事项，必须在 JAI 的实际依赖和目标平台上用同一套产物分解方法测量。
