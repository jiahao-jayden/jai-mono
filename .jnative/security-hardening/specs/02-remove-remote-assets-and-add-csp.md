# 02: 移除远程资源并加 CSP

要先完成:无 · 状态:⬜

## 交付什么

应用启动不再发起任何用户没有发起的网络请求，「数据不离开机器」的承诺在启动路径上真正成立。主窗口有一条内容安全策略兜住远程资源加载，而现有界面的每一处渲染都照常工作。

## 范围

做:

- 删掉 `index.html` 里的 Google Fonts `<link>`。它加载 Inter 和 Playfair Display，这两个字体在整个样式表的字体栈里一次都没出现；实际使用的 Manrope 和 Source Serif 4 已经通过 `@fontsource-variable/*` 本地打包，IBM Plex Mono 走系统回退。
- 顺手把 `<title>` 从旧产品名 `noa.` 改成 PandaWork。
- 给主窗口加 CSP。开发和生产两套策略：生产收到 `default-src 'self'` 起步，开发要为 Vite HMR 放开 `connect-src` 的 ws 和 `script-src` 的 inline。
- 逐个验证现有渲染没有被打破，清单见「完成前检查」。

不做:

- 外链与导航（第 01 项）。
- 改动 workspace HTML preview iframe 自己的 CSP。只需确认外层策略不会把它挡掉。
- 引入新的字体依赖。IBM Plex Mono 目前走系统回退，是既有状态，本项不改。

## 需要遵守的整体选择

- Electron 安全清单按「行为参考」落地，本项只落「定义 CSP」一条，见 plan.md 的「外部产品或规范的约定」。
- CSP 用响应头还是 meta 标签由实施时定，写进「决策记录」。生产走 `loadFile`，开发走 Vite dev server，两种加载方式对注入点的约束不同，先确认再动手。

## 开始前确认

先在对话里说清下面三项。说不清说明 spec 没读够，或 spec 本身没写清；回去读或补 spec，不要边猜边写：

- 本次会改到哪些长期保存的数据，以及哪个模块维护它们
- 本次必须遵守哪些项目规则（见下）
- 这次不碰什么（上一个 spec 的「交接说明」和本项范围外的内容）

## 长期保存的数据与维护方

无。

## 必须遵守的项目规则

> - `app/desktop/electron/main.ts`、`preload.ts`、`runtime.ts` 是 Electron 入口与 composition root；`logger.ts`、`theme.ts`、`windows.ts` 是进程级系统能力。

CSP 属于进程级系统能力。

> 7. 修改 Desktop UI 后，至少检查 Shell 中是否新增了无合理例外的原生 `<button>` 或直接图标库引用，并运行 TypeScript 检查与相关测试。

> 2. 选能满足当前需求的最简单实现。不要预防性抽象，不要多此一举的配置层。

策略字符串直接写在代码里，按 `app.isPackaged` 分支，不做成配置文件。

## 风险

- **这是本次最危险的一步。** Streamdown 的代码高亮、表格全屏、mermaid 图、图片预览、`motion` 的动态样式都可能依赖 inline style 或 `blob:` / `data:` URL。CSP 一旦收紧就是全局生效。
- workspace HTML preview iframe 有自己的 CSP，要确认外层策略不会把它一起挡掉。
- 必须逐个页面手动验证，不能只靠类型检查和单测通过就标完成。

## 完成前检查

下面的检查没有跑完、也没有贴出真实输出前，不能标 ✅：

- [ ] 启动应用后打开 DevTools Network，确认没有任何指向外部域名的请求
- [ ] DevTools Console 无 CSP violation 报错
- [ ] 逐项手动验证渲染正常：普通 markdown 回复、代码块高亮与复制、表格全屏、mermaid 图（若有内容能触发）、图片附件缩略图、workspace HTML preview、明暗主题切换、带动效的消息进入
- [ ] 确认 Manrope 与 Source Serif 4 仍正常显示（字体已本地打包，不应受影响）
- [ ] 开发模式下 Vite HMR 仍能热更新
- [ ] `(cd app/desktop && bun run typecheck)`
- [ ] `(cd app/desktop && bun test)`
- [ ] `bun run lint`

## 决策记录

<!-- 只记录这项工作实施时出现的局部、非显然选择；改变整套方案时回到 plan.md。-->

## 遗留问题

<!-- 发现但本次不做的 -->

## 交接说明

<!-- 完成或暂停时填：做到哪里、下一项不要碰什么。写给下次继续工作的人看，要具体。 -->
