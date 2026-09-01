import type { DesktopUiLocale } from "../../shared/desktop-rpc";
import enMessages from "./compiled/en.json";
import zhCnMessages from "./compiled/zh-CN.json";

export type DesktopMessages = Record<string, string>;

export const desktopMessages: Record<DesktopUiLocale, DesktopMessages> = {
	en: enMessages,
	"zh-CN": zhCnMessages,
};
