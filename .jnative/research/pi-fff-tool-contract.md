# Pi / FFF 工具契约

核验日期:2026-08-27。来源钉住为 Pi 官方包页上的 `@ff-labs/pi-fff` 0.10.5；原生 binding 的 ABI 与发行包行为仍需在本特性的 Spec 01 中对实际依赖做 smoke test。

## 已核对

- `@ff-labs/pi-fff` 是 Pi extension，说明为 FFF-powered fuzzy file and content search。
- 工具名为 `fffind`、`ffgrep`、`fff-multi-grep`；`fffind` 做 frecency-ranked fuzzy file search，`ffgrep` 做内容搜索并接受 cursor，`fff-multi-grep` 做多 literal pattern 的 OR 搜索。
- 扩展的默认 mode 是 `tools-and-ui`，默认注册 `fffind` 与 `ffgrep`；当前源码用 `PI_FFF_MULTIGREP=1` 才额外注册 `fff-multi-grep`，`override` mode 才替换 Pi 内置 `find`/`grep`。
- 官方包页说明扩展在本地运行，不上传项目文件；其 frecency/history 状态使用本地 LMDB 数据目录。

来源:

- [Pi package page](https://pi.dev/packages/@ff-labs/pi-fff)
- [FFF repository](https://github.com/dmtrKovalenko/fff)
