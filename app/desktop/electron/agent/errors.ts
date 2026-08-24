import { TaggedError } from "better-result";

type DesktopAgentErrorInit = {
	readonly data?: { readonly entryId?: string; readonly sessionId: string };
	readonly message: string;
};

class DesktopAgentFactoryUnavailable extends TaggedError("desktop_agent.factory_unavailable")<DesktopAgentErrorInit> {}
class DesktopAgentSessionNotFound extends TaggedError("desktop_agent.session_not_found")<DesktopAgentErrorInit> {}
class DesktopAgentSessionBusy extends TaggedError("desktop_agent.session_busy")<DesktopAgentErrorInit> {}
class DesktopAgentNavigationFailed extends TaggedError("desktop_agent.navigation_failed")<DesktopAgentErrorInit> {}

export function desktopAgentError(
	reason: "factory_unavailable" | "session_not_found" | "session_busy" | "navigation_failed",
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
	}
}
