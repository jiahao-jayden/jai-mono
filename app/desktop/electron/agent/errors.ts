import { TaggedError } from "better-result";

type DesktopAgentErrorInit = {
	readonly data?: { readonly entryId?: string; readonly sessionId: string };
	readonly message: string;
};

class DesktopAgentFactoryUnavailable extends TaggedError("desktop_agent.factory_unavailable")<DesktopAgentErrorInit> {}
class DesktopAgentSessionNotFound extends TaggedError("desktop_agent.session_not_found")<DesktopAgentErrorInit> {}
class DesktopAgentSessionBusy extends TaggedError("desktop_agent.session_busy")<DesktopAgentErrorInit> {}
class DesktopAgentNavigationFailed extends TaggedError("desktop_agent.navigation_failed")<DesktopAgentErrorInit> {}
class DesktopAgentUnsupportedOperation extends TaggedError(
	"desktop_agent.unsupported_operation",
)<DesktopAgentErrorInit> {}
class DesktopAgentRetryUnavailable extends TaggedError("desktop_agent.retry_unavailable")<DesktopAgentErrorInit> {}
class DesktopAgentCompactionUnavailable extends TaggedError(
	"desktop_agent.compaction_unavailable",
)<DesktopAgentErrorInit> {}

export function desktopAgentError(
	reason:
		| "factory_unavailable"
		| "session_not_found"
		| "session_busy"
		| "navigation_failed"
		| "unsupported_operation"
		| "retry_unavailable"
		| "compaction_unavailable",
	init: DesktopAgentErrorInit,
) {
	switch (reason) {
		case "factory_unavailable":
			return new DesktopAgentFactoryUnavailable(init);
		case "session_not_found":
			return new DesktopAgentSessionNotFound(init);
		case "session_busy":
			return new DesktopAgentSessionBusy(init);
		case "navigation_failed":
			return new DesktopAgentNavigationFailed(init);
		case "unsupported_operation":
			return new DesktopAgentUnsupportedOperation(init);
		case "retry_unavailable":
			return new DesktopAgentRetryUnavailable(init);
		case "compaction_unavailable":
			return new DesktopAgentCompactionUnavailable(init);
	}
}
