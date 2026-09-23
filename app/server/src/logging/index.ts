/**
 * Runtime Host 诊断日志。
 *
 * 拥有 `<dataDirectory>/logs/runtime-host/host.log`（10MB × 5，按大小轮转）。
 * 写入是尽力而为：失败只丢这一条，不抛给调用方，也不拥有产品事实。
 */
export {
	type HostLog,
	type HostLogOptions,
	type HostLogTextOutput,
	hostLogPath,
	type LogContext,
	type LogLevel,
	openHostLog,
} from "./logger";
