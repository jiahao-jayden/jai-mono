import type { CodingExtensionApprovalRequest, CodingPermissionRequest } from "@jai/coding-agent";
import type { DesktopExtensionApprovalRequest, DesktopPermissionItem } from "../../../shared/desktop-rpc";

/** Drops raw tool arguments after the SDK has prepared a renderer-safe permission summary. */
export function projectPermissionRequest(request: CodingPermissionRequest): DesktopPermissionItem["request"] {
	return {
		requestId: request.requestId,
		sessionId: request.sessionId,
		toolCallId: request.toolCallId,
		toolName: request.toolName,
		reason: request.reason,
		canAlwaysAllow: request.canAlwaysAllow,
		summary: request.summary,
		...(request.suggestedRule ? { suggestedRule: request.suggestedRule } : {}),
		...(request.rememberScope ? { rememberScope: request.rememberScope } : {}),
	};
}

export function projectExtensionApprovalRequest(
	request: CodingExtensionApprovalRequest,
): DesktopExtensionApprovalRequest {
	return {
		requestId: request.requestId,
		extensionId: request.extensionId,
		operationId: request.operationId,
		sessionId: request.sessionId,
		toolCallId: request.toolCallId,
		reason: request.reason,
		sideEffect: request.sideEffect,
		dataSensitivity: request.dataSensitivity,
		presentation: {
			title: request.presentation.title,
			...(request.presentation.description ? { description: request.presentation.description } : {}),
			...(request.presentation.attributes
				? {
						attributes: request.presentation.attributes.map((attribute) => ({
							label: attribute.label,
							value: attribute.value,
						})),
					}
				: {}),
		},
		...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
	};
}
