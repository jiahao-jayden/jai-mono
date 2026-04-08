import log from "electron-log/main";

log.initialize();

log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB
log.transports.file.format = "{y}-{m}-{d} {h}:{i}:{s}.{ms} [{level}] {scope} {text}";
log.transports.console.format = "{h}:{i}:{s}.{ms} [{level}] {scope} {text}";

export default log;

export const mainLog = log.scope("main");
export const gatewayLog = log.scope("gateway");
