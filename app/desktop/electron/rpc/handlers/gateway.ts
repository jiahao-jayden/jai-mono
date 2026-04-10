import { gatewayProcess } from "../../gateway-process";
import type { RpcSchema } from "../schema";
import type { RpcHandlers } from "../types";

export const gatewayHandlers: RpcHandlers<RpcSchema>["gateway"] = {
	info() {
		return {
			port: gatewayProcess.port,
			baseURL: gatewayProcess.baseURL,
			ready: gatewayProcess.ready,
		};
	},
};
