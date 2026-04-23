import { gw, health, waitForReady } from "./client";
import { createConfigApi } from "./config";
import { createMessagesApi } from "./messages";
import { createPluginsApi } from "./plugins";
import { createSessionsApi } from "./sessions";
import { createWorkspaceApi } from "./workspace";

export type { SSEEvent } from "./sse-parser";

export const gateway = {
	health,
	waitForReady,
	sessions: createSessionsApi(gw),
	config: createConfigApi(gw),
	messages: createMessagesApi(gw),
	workspace: createWorkspaceApi(gw),
	plugins: createPluginsApi(gw),
};
