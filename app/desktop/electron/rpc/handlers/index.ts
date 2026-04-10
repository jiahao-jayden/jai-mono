import type { RpcSchema } from "../schema";
import type { RpcHandlers } from "../types";
import { gatewayHandlers } from "./gateway";
import { themeHandlers } from "./theme";
import { windowHandlers } from "./window";

export function createHandlers(): RpcHandlers<RpcSchema> {
	return {
		window: windowHandlers,
		theme: themeHandlers,
		gateway: gatewayHandlers,
	};
}
