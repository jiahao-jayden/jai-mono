import { useCallback } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { desktop, getDesktopRemoteRpcFailure } from "@/lib/desktop";
import { notifyFailure } from "@/lib/failure";
import type { DesktopSubagentItem } from "../../shared/desktop-rpc";

/** Stops one running background subagent; the status flip arrives as a transcript event. */
export function useStopSubagent(sessionId: string | undefined) {
	const intl = useIntl();
	return useCallback(
		(item: DesktopSubagentItem) => {
			if (!sessionId) return;
			void desktop.agent.stopSubagent({ sessionId, toolCallId: item.toolCallId }).catch((error: unknown) => {
				notifyFailure(getDesktopRemoteRpcFailure(error), intl, {
					title: intl.formatMessage(desktopMessages.subagentStopFailed),
					dedupeKey: `subagent-stop:${item.toolCallId}`,
				});
			});
		},
		[intl, sessionId],
	);
}
