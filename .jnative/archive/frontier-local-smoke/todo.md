# Frontier local smoke runner：待办

状态：⚠️ 已实现；真实 Docker trial 受宿主磁盘配额能力阻断  
日期：2026-09-03

## 交付顺序

- [x] Work 1：固定 task-definition contract，并证明 Linux runtime 可构建现有 JAI CLI、Server ACP
  和 Linux-native FFF runtime。
- [x] Work 2：实现 task internal-only network、provider gateway、临时无密钥 Server 配置及
  Docker 资源限制 fail-closed 行为。
- [x] Work 3：实现单 trial 生命周期、结果/证据投影与 cleanup，并执行 `build-cython-ext` 的真实
  Docker preflight。

## 当前阻塞

- 当前 OrbStack backend 不支持 `--storage-opt size=…`（需要 overlay over XFS with `pquota`）。
  `build-cython-ext` 声明 `storage_mb = 10240`，runner 因而在 144ms 的 setup preflight 中 fail
  closed，未构建 task image、更未调用模型。安全证据位于
  `/private/tmp/jai-frontier-results/trial-HuElvQ/result.json`。
- 要完成真实 agent trial，需改用能够强制 container writable-layer quota 的 Linux Docker backend
  （overlay2 + XFS project quota），或取得 Frontier 的远程 sandbox/controller；不会在 OrbStack
  上放宽磁盘限制。

## 完成定义

- [x] 代码、类型检查、单元测试、CLI ACP mock E2E 与安全 cleanup 检查通过。
- [x] 没有把 host `~/.jai`、provider key、未筛选错误或新的 durable state 带进 trial。
- [x] E2E/preflight 结果明确作为 smoke evidence，而不是官方 Frontier score。
