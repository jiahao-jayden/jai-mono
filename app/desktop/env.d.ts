/// <reference types="vite/client" />

declare module "*.css";
declare module "electron-log/preload";

import type { DesktopBridge } from "./shared/desktop-rpc";

declare global {
	interface Window {
		desktopRpc: DesktopBridge;
		__electronLog: {
			sendToMain(message: Record<string, unknown>): void;
			log(...data: unknown[]): void;
			error(...data: unknown[]): void;
			warn(...data: unknown[]): void;
			info(...data: unknown[]): void;
			verbose(...data: unknown[]): void;
			debug(...data: unknown[]): void;
		};
	}
}
