# Signal Desktop 与 Element Desktop 的 Electron 安装包体积控制

核验日期：2026-09-12。Signal 固定到 `6aea489bd04f31f6070538ffdbcea9fcf492479d`（源码 `package.json` 显示版本 `8.30.0-alpha.1`）；Element 固定到 `87baf1246be4e94345f84c2b74b75092243c5b35`（源码 `package.json` 显示版本 `1.12.8`）。使用完整 SHA 的源码 permalink，避免后续构建配置变化混入结论。

## 结论

1. Signal 的体积控制主轴是“先用 Rolldown 生成生产 bundle，再用 electron-builder 的 `files` 白名单装入包”；Element 的主轴是“把 Web 应用预先打成独立的 `webapp.asar`，Electron 壳只装 `lib/**`、少量元数据和资源”。这两种方案都能缩小 Electron 壳的职责，但只有 Signal 在当前配置里直接呈现生产压缩与入口拆分证据。[Signal](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L67-L109) · [Element](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L93-L126)
2. Signal 将主进程、preload、worker 和沙盒窗口拆成多个入口，并对沙盒 preload 关闭 code splitting；Element 不在 Electron 壳内重打包 Web 应用，而是通过 `asar-webapp` 脚本把 `webapp` 目录打成 `webapp.asar` 后作为 `extraResources` 携带。[Signal](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/rolldown.config.ts#L91-L179) · [Element](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/package.json#L15-L39)
3. 两者都把 `.node` 原生模块列入 `asarUnpack`；Signal 还用 `files` 精确挑选每个平台对应的 prebuild，Element 则由 `.hak/hakModules` 作为壳内 `node_modules` 来源，并让 `hak` 负责 `matrix-seshat` 等原生依赖。[Signal](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L225-L302) · [Element](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L93-L126)
4. Signal 的平台构建在一个 `package.json` 中按 macOS、MAS、Windows、Linux 分开定义目标、架构、签名和依赖；Element 用一个 TypeScript 配置按平台选择 DMG/ZIP、Squirrel/MSI、tar.gz/deb，并通过 variant 文件改变品牌、协议和可执行文件名。[Signal](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L112-L209) · [Element](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L55-L92)
5. Signal 的策略不成立于“所有代码都能安全地合成一个共享 bundle”：沙盒 preload 明确要求独立 bundle，因为它们不能使用 `require()`；Element 的策略不成立于“只复制 Web 资源即可”：Electron 壳仍需 `lib/**`、`.hak/hakModules`、原生 `.node` 与平台资源。[Signal](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/rolldown.config.ts#L144-L179) · [Element](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L93-L126)
6. Element 的 Linux 产物可以通过系统包依赖减小自带内容：默认把 `libsqlcipher0` 放在 `recommends`，只有设置 `SQLCIPHER_BUNDLED` 时才移除该推荐依赖；这说明“系统依赖替代随包资源”是有条件的发行策略，不是通用的体积开关。[Element](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L127-L197)
7. 两个项目都保留 Electron 运行时本体的固定成本；源码证据只支持“减少应用层资源和错误平台资源”，不能推出具体安装包能缩小多少，也没有在本次调研中找到官方体积基准。[Signal](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L225-L302) · [Element](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L93-L126)
8. 对 JAI Desktop 最直接的可迁移做法是先收紧 `files`/资源白名单、按平台只带一个原生模块变体，再决定是否把大型 Web 资源拆成独立 archive；是否采用 Element 式 `webapp.asar`，取决于这些资源是否能拥有独立的构建和加载边界。[Signal](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L225-L302) · [Element](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L93-L126)

## 同一组维度比较

| 维度 | Signal Desktop | Element Desktop |
|---|---|---|
| 打包器与入口 | `electron-builder` 负责平台封装；Rolldown 先生成多个生产入口和 chunks。[Signal package.json](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L67-L109) · [Signal rolldown.config.ts](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/rolldown.config.ts#L91-L179) | `electron-builder` 读取 TypeScript 配置；Web 应用由脚本先生成 `webapp.asar`。[Element package.json](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/package.json#L15-L39) · [Element electron-builder.ts](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L93-L126) |
| asar / extraResources | 默认 asar；关闭 `smartUnpack`，统一 unpack `.node`；Linux 额外只带 policy 文件。[Signal package.json](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L210-L245) | `asarUnpack: "**/*.node"`；`extraResources` 只放 `build/icon.*` 与 `webapp.asar`。[Element electron-builder.ts](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L93-L126) |
| 依赖与原生模块 | `files` 先排除通用 `build/prebuilds`、源码和测试，再按 `${platform}-${arch}` 选择 Signal 原生包；Rolldown 外置 native libraries 与 3.7 MB 的 `google-libphonenumber`。[Signal package.json](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L245-L302) · [Signal rolldown.config.ts](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/rolldown.config.ts#L9-L35) | `.hak/hakModules` 映射为壳内 `node_modules`；`hakDependencies` 声明 `matrix-seshat`；构建后运行 `electron-builder install-app-deps`。[Element electron-builder.ts](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L100-L106) · [Element package.json](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/package.json#L35-L72) |
| 平台产物 | macOS ZIP/DMG，MAS；Windows NSIS；Linux x64 deb；每个平台有独立签名、架构和系统最低版本字段。[Signal package.json](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L112-L209) | macOS DMG/ZIP；Windows Squirrel/MSI；Linux tar.gz/deb；variant 可覆盖品牌和协议。[Element electron-builder.ts](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L55-L92) · [Element electron-builder.ts](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L127-L170) |
| 限制 | 沙盒 preload 不能 `require()`，所以不能把所有 preload 合成共享 bundle；`.node` 仍必须 unpack。[Signal rolldown.config.ts](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/rolldown.config.ts#L144-L179) · [Signal package.json](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L225-L232) | 壳仍依赖 `lib/**`、`.hak/hakModules` 和原生模块；Linux 去掉 `libsqlcipher0` 只在 `SQLCIPHER_BUNDLED` 已设置时成立。[Element electron-builder.ts](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L100-L126) · [Element electron-builder.ts](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L171-L197) |

## Signal Desktop

### 打包器与运行时拆分

Signal 的构建链是 `build:rolldown:prod` 先以 `--minify` 生成 bundle，随后 `build:electron` 调用 `electron-builder`；Rolldown 输出目录为 `bundles`，并启用按名称带 hash 的 chunks。[源码链接](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L67-L109)

```text
"build": "run-s --print-label generate build:rolldown:prod build:release",
"build:rolldown:prod": "pnpm build:rolldown --minify",
"build:electron": "cross-env NODE_OPTIONS='--import=tsx' electron-builder --config.extraMetadata.environment=$SIGNAL_ENV",
"build:release": "cross-env SIGNAL_ENV=production pnpm run build:electron --config.directories.output=release",
```

```ts
output: {
  format: 'cjs',
  dir: 'bundles',
  chunkFileNames: 'chunks/[name]-[hash].js',
  sourcemap: !isProd,
},
```

Rolldown 配置把主进程、配置、preload 和 worker 列为独立入口；沙盒 preload 逐项生成独立 bundle，并显式关闭 code splitting。[源码链接](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/rolldown.config.ts#L91-L179)

```ts
const sandboxPreload = {
  'preload/about': 'ts/windows/about/preload.preload.ts',
  'preload/calldiagnostic': 'ts/windows/calldiagnostic/preload.preload.ts',
  'preload/debuglog': 'ts/windows/debuglog/preload.preload.ts',
  'preload/pdf': 'ts/windows/pdf/preload.preload.ts',
  'preload/permissions': 'ts/windows/permissions/preload.preload.ts',
  'preload/screenShare': 'ts/windows/screenShare/preload.preload.ts',
  'preload/sticker-creator': 'ts/windows/sticker-creator/preload.preload.ts',
};
```

```ts
// Each sandboxed bundle has to be separate from the rest since
// they cannot use `require()`
...Object.entries(sandboxPreload).map(([key, value]): RolldownOptions => {
  return {
    ...defaults,
    external: ['electron'],
    platform: 'browser',
    input: { [key]: value },
    output: { ...defaults.output, codeSplitting: false },
  };
}),
```

### asar、资源白名单与原生模块

Signal 通过 `files` 白名单把构建产物限制为运行所需文件，并排除源码、构建目录、测试文件、映射文件、通用 prebuild 与 C/C++ 源文件；`.node` 只按当前平台和架构选择。[源码链接](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L225-L302)

```json
"asar": { "smartUnpack": false },
"asarUnpack": ["**/*.node"],
"files": [
  "package.json",
  "config/default.json",
  "config/${env.SIGNAL_ENV}.json",
  "bundles/**",
  "!ts/**",
  "!build",
  "!**/*.{bak,bnf,flow,patch,markdown,ts,map}",
  "!**/node_modules/**/prebuilds/**",
```

```json
"node_modules/@signalapp/sqlcipher/prebuilds/${platform}-${arch}/*.node",
"node_modules/@signalapp/libsignal-client/prebuilds/${platform}-${arch}/*.node",
"node_modules/@signalapp/ringrtc/build/${platform}/*${arch}*.node",
"node_modules/@signalapp/windows-ucv/build/Release/*.node",
"node_modules/@signalapp/mute-state-change/build/Release/*.node",
"node_modules/@indutny/simple-windows-notifications/prebuilds/${platform}-${arch}/*.node",
"node_modules/@indutny/mac-screen-share/prebuilds/${platform}-${arch}/*.node",
"!node_modules/tar",
"sticker-creator/dist/**"
```

Rolldown 把原生库外置，避免把 native implementation 合进 JavaScript bundle；它还明确把 `google-libphonenumber` 标为大型库，总计 3.7 MB，并以 external 方式保留运行时加载。[源码链接](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/rolldown.config.ts#L9-L35)

```ts
const external = [
  // Native libraries
  '@signalapp/libsignal-client',
  '@signalapp/ringrtc',
  '@signalapp/sqlcipher',
  '@signalapp/mute-state-change',
  '@signalapp/windows-ucv',
  '@indutny/simple-windows-notifications',
  '@indutny/mac-screen-share',
  '@napi-rs/canvas',
  'electron',
```

```ts
  // Large libraries (3.7mb total)
  'google-libphonenumber',

  // Imported, but not used in production builds
  'mocha',
```

### 平台产物与限制

Signal 同一份 electron-builder 配置按平台选择产物：macOS 输出 x64/arm64 ZIP 和 universal DMG，Windows 输出 NSIS，Linux 输出 x64 deb；Windows 只 unpack 图标，通用 `.node` 规则仍覆盖原生模块。[源码链接](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/package.json#L112-L209)

```json
"mac": {
  "artifactName": "${name}-mac-${arch}-${version}.${ext}",
  "mergeASARs": true,
  "target": [
    { "target": "zip", "arch": ["x64", "arm64"] },
    { "target": "dmg", "arch": ["universal"] }
  ]
},
"win": {
  "artifactName": "${name}-win-${arch}-${version}.${ext}",
  "target": ["nsis"],
```

Signal 的拆分策略不成立于“所有入口共享同一个可调用环境”：配置注释明确指出沙盒 preload 不能使用 `require()`，所以每个沙盒 preload 需要自己的 bundle；同时原生 `.node` 必须 unpack，不能仅依赖 asar 内路径。[源码链接](https://github.com/signalapp/Signal-Desktop/blob/6aea489bd04f31f6070538ffdbcea9fcf492479d/rolldown.config.ts#L144-L179)

```ts
// Each sandboxed bundle has to be separate from the rest since
// they cannot use `require()`
...Object.entries(sandboxPreload).map(([key, value]): RolldownOptions => {
  return {
    ...defaults,
    input: { [key]: value },
    output: { ...defaults.output, codeSplitting: false },
  };
}),
```

## Element Desktop

### Electron 壳与独立 webapp.asar

Element 的脚本把 `webapp` 目录打成 `webapp.asar`；启动和构建都会先编译 TypeScript、复制资源，再由 electron-builder 封装。Electron 壳自身的 `files` 只有 `package.json`、`.hak/hakModules` 和 `lib/**`，而 `webapp.asar` 被放到 `extraResources`。[源码链接](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/package.json#L15-L39)

```json
"asar-webapp": "asar p webapp webapp.asar",
"start": "yarn run build:ts && yarn run build:res && electron .",
"build": "yarn run build:ts && yarn run build:res && electron-builder",
"build:res": "tsx scripts/copy-res.ts",
"postinstall": "patch-package && electron-builder install-app-deps"
```

```ts
files: [
    "package.json",
    {
        from: ".hak/hakModules",
        to: "node_modules",
    },
    "lib/**",
],
extraResources: ["build/icon.*", "webapp.asar"],
```

这意味着 Element 把 Web 层资源的打包边界放在 Electron 壳之外；该边界成立的条件是 Web 应用可以独立生成并按运行时约定被加载。[源码链接](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L93-L126)

```ts
asarUnpack: "**/*.node",
files: [
    "package.json",
    { from: ".hak/hakModules", to: "node_modules" },
    "lib/**",
],
extraResources: ["build/icon.*", "webapp.asar"],
extraMetadata: {
    name: variant.name,
    productName: variant.productName,
```

### 依赖、原生模块与 Linux 条件

Element 使用 `hak` 管理原生依赖，`hakDependencies` 当前声明 `matrix-seshat`；构建配置把 `.hak/hakModules` 复制到应用内 `node_modules`，并关闭 `nodeGypRebuild`、保留 `npmRebuild`。[源码链接](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/package.json#L65-L74)

```json
"build:native": "yarn run hak",
"build:native:universal": "yarn run hak --target x86_64-apple-darwin fetchandbuild && yarn run hak --target aarch64-apple-darwin fetchandbuild && yarn run hak --target x86_64-apple-darwin --target aarch64-apple-darwin copyandlink",
"postinstall": "patch-package && electron-builder install-app-deps",
"hakDependencies": {
    "matrix-seshat": "^4.0.1"
}
```

```ts
nativeRebuilder: "sequential",
nodeGypRebuild: false,
npmRebuild: true,
```

Linux 默认把 `libsqlcipher0` 放入 deb 的 `recommends`；只有设置 `SQLCIPHER_BUNDLED`，配置才会移除该推荐依赖。这是系统库与随包库之间的条件选择，不是无条件减包。[源码链接](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L127-L197)

```ts
recommends: ["libsqlcipher0", "element-io-archive-keyring"],
```

```ts
if (process.env.SQLCIPHER_BUNDLED) {
    // Remove sqlcipher dependency when using bundled
    config.deb.recommends = config.deb.recommends?.filter((d) => d !== "libsqlcipher0");
}
```

### 平台产物、variant 与限制

Element 的平台目标分别是 Linux `tar.gz`/`deb`、macOS `dmg`/`zip`、Windows `squirrel`/`msi`；variant 文件覆盖 appId、可执行文件名、品牌名和协议，适合 stable/nightly 等发行变体。[源码链接](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L55-L92)

```ts
const DEFAULT_VARIANT = path.join("element.io", "release", "build.json");
let variant: Variant = JSON.parse(fs.readFileSync(DEFAULT_VARIANT, "utf8"));
if (process.env.VARIANT_PATH) {
    variant = {
        ...variant,
        ...JSON.parse(fs.readFileSync(`${process.env.VARIANT_PATH}`, "utf8")),
    };
}
```

```ts
linux: {
    target: ["tar.gz", "deb"],
},
mac: {
    target: ["dmg", "zip"],
    mergeASARs: true,
},
win: {
    target: ["squirrel", "msi"],
},
```

Element 的“轻量壳”策略不成立于“应用只需要 `webapp.asar`”：配置仍必须携带 `lib/**`、`.hak/hakModules`、`build/icon.*` 与 unpack 的 `.node`；Linux 去掉 `libsqlcipher0` 也只在 `SQLCIPHER_BUNDLED` 已设置时成立。[源码链接](https://github.com/element-hq/element-desktop/blob/87baf1246be4e94345f84c2b74b75092243c5b35/electron-builder.ts#L93-L126)

```ts
asarUnpack: "**/*.node",
files: [
    "package.json",
    {
        from: ".hak/hakModules",
        to: "node_modules",
    },
    "lib/**",
],
extraResources: ["build/icon.*", "webapp.asar"],
```

## 来源覆盖

| 来源类别 | 查到了什么 |
|---|---|
| 官方文档 / 源码 | 查阅 Signal 的 `package.json`、`rolldown.config.ts`，以及 Element 的 `package.json`、`electron-builder.ts`；分别固定到 `6aea489bd04f31f6070538ffdbcea9fcf492479d` 和 `87baf1246be4e94345f84c2b74b75092243c5b35`。 |
| 作者或维护者本人的说法 | 未找到针对“安装包体积”主题的 Signal/Element 维护者专文；已检查两仓库 README、构建入口和公开构建配置，结论只使用源码事实。 |
| 同类方案 | 对比 Signal 的 Rolldown 多入口 + 白名单方案与 Element 的独立 `webapp.asar` + Electron 壳方案；另检查了 Electron-builder 作为两者共同的封装层，但未把其通用文档当作项目行为证据。 |
| issue / PR / 社区实践 | 检查两仓库与 `bundle size`、`asar`、`layered build` 相关的 PR 搜索结果；命中的主要是 Electron 版本升级和常规依赖更新，未发现能推翻当前源码结论的体积专项维护者讨论。 |
| 历史演变 | 检查 Element 的近期 release/CHANGELOG 入口与仓库构建配置；未找到可用于量化体积变化的官方历史基准，因此不写体积增减估算。 |

## 对本项目的影响

优先级应放在应用层文件边界：建立可审计的 `files` 白名单，排除源码、测试、映射、通用 prebuild 和构建中间物；按 `${platform}-${arch}` 只装当前平台原生 `.node`，统一通过 `asarUnpack` 处理必须落盘加载的 native addon。Signal 的做法适合 JAI 仍由一个 Electron 应用直接承载多类入口的情况。

若 Web 资源本身已经有独立构建产物和稳定加载协议，可以参考 Element，把它们先生成单独 archive，再作为 `extraResources` 携带。这个选择会增加独立构建、加载和调试边界；本次来源没有证据支持它必然比白名单 + bundle 更小。

没有证据支持直接通过换用某个打包器或移除 Electron runtime 获得确定的体积收益；也没有官方数据支持给 JAI 设定具体 MB 目标。应在每个平台产物上分别记录 archive、解包目录和 `app.asar`/外置资源大小，再依据实际构建结果决定下一步。
