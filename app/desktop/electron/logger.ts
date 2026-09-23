import { join } from "node:path";
import { resolveJaiDataDirectory } from "@jai/server/acp-client";
import log from "electron-log/main";

log.initialize();

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB
log.transports.file.format = "{y}-{m}-{d} {h}:{i}:{s}.{ms} [{level}] {scope} {text}";
log.transports.file.transforms.unshift(({ data }) =>
	data.map((item) => (typeof item === "string" ? item.replace(ANSI_PATTERN, "") : item)),
);
log.transports.console.format = "%c{h}:{i}:{s}.{ms} [{level}] {scope}%c {text}";
log.transports.console.useStyles = process.env.NO_COLOR === undefined;
log.transports.file.resolvePathFn = () => join(resolveJaiDataDirectory(), "logs", "desktop", "main.log");

export default log;

export const mainLog = log.scope("main");
