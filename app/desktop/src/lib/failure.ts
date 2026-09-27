import type { IntlShape, MessageDescriptor } from "react-intl";
import { toast } from "@/components/ui/toast";
import { desktopMessages } from "@/i18n/messages";
import type { DesktopFailure, DesktopFailureCode } from "../../shared/desktop-rpc";

export type DesktopFailureAction = NonNullable<DesktopFailure["action"]>;

export interface PresentedFailure {
	readonly title: string;
	readonly description: string;
	/** Redacted diagnostics for a copy affordance; never the primary text. */
	readonly detail?: string;
	readonly actions: readonly { readonly action: DesktopFailureAction; readonly label: string }[];
}

const failureCopy: Readonly<
	Record<DesktopFailureCode, { readonly title: MessageDescriptor; readonly description: MessageDescriptor }>
> = {
	"provider.auth_failed": {
		title: desktopMessages.failureProviderAuthFailedTitle,
		description: desktopMessages.failureProviderAuthFailedDescription,
	},
	"provider.rate_limited": {
		title: desktopMessages.failureProviderRateLimitedTitle,
		description: desktopMessages.failureProviderRateLimitedDescription,
	},
	"provider.context_overflow": {
		title: desktopMessages.failureProviderContextOverflowTitle,
		description: desktopMessages.failureProviderContextOverflowDescription,
	},
	"provider.invalid_request": {
		title: desktopMessages.failureProviderInvalidRequestTitle,
		description: desktopMessages.failureProviderInvalidRequestDescription,
	},
	"provider.unavailable": {
		title: desktopMessages.failureProviderUnavailableTitle,
		description: desktopMessages.failureProviderUnavailableDescription,
	},
	"provider.network": {
		title: desktopMessages.failureProviderNetworkTitle,
		description: desktopMessages.failureProviderNetworkDescription,
	},
	"provider.credential_required": {
		title: desktopMessages.failureProviderCredentialRequiredTitle,
		description: desktopMessages.failureProviderCredentialRequiredDescription,
	},
	"provider.model_unavailable": {
		title: desktopMessages.failureProviderModelUnavailableTitle,
		description: desktopMessages.failureProviderModelUnavailableDescription,
	},
	"runtime.operation_failed": {
		title: desktopMessages.failureRuntimeOperationFailedTitle,
		description: desktopMessages.failureRuntimeOperationFailedDescription,
	},
	"runtime.interrupted": {
		title: desktopMessages.failureRuntimeInterruptedTitle,
		description: desktopMessages.failureRuntimeInterruptedDescription,
	},
	"configuration.invalid": {
		title: desktopMessages.failureConfigurationInvalidTitle,
		description: desktopMessages.failureConfigurationInvalidDescription,
	},
	"runtime.retry_unavailable": {
		title: desktopMessages.failureRuntimeRetryUnavailableTitle,
		description: desktopMessages.failureRuntimeRetryUnavailableDescription,
	},
	"connection.reconnecting": {
		title: desktopMessages.failureConnectionReconnectingTitle,
		description: desktopMessages.failureConnectionReconnectingDescription,
	},
	"connection.restart_failed": {
		title: desktopMessages.failureConnectionRestartFailedTitle,
		description: desktopMessages.failureConnectionRestartFailedDescription,
	},
	"session.workspace_required": {
		title: desktopMessages.failureSessionWorkspaceRequiredTitle,
		description: desktopMessages.failureSessionWorkspaceRequiredDescription,
	},
	"request.failed": {
		title: desktopMessages.failureRequestFailedTitle,
		description: desktopMessages.failureRequestFailedDescription,
	},
	unknown: {
		title: desktopMessages.failureUnknownTitle,
		description: desktopMessages.failureUnknownDescription,
	},
};

const actionLabels: Readonly<Record<DesktopFailureAction, MessageDescriptor>> = {
	retry: desktopMessages.commonRetry,
	open_provider_settings: desktopMessages.failureActionOpenProviderSettings,
	reconnect: desktopMessages.chatRecoveryRetryConnection,
	choose_project: desktopMessages.failureActionChooseProject,
	choose_model: desktopMessages.modelChoose,
};

/** Toast layer for a failure that follows a user action; failures bound to visible content stay in place. */
export function notifyFailure(
	failure: DesktopFailure,
	intl: IntlShape,
	options: {
		readonly dedupeKey?: string;
		/** Names the action that failed; the code's description still explains why. */
		readonly title?: string;
		readonly onAction?: (action: DesktopFailureAction) => void;
	} = {},
): string {
	const presented = presentFailure(failure, intl);
	const [action] = options.onAction ? presented.actions : [];
	const persistent = action !== undefined || presented.detail !== undefined;
	return toast.add({
		id: options.dedupeKey,
		type: "error",
		title: options.title ?? presented.title,
		description: presented.description,
		timeout: persistent ? 0 : undefined,
		priority: persistent ? "high" : undefined,
		actionProps: action ? { children: action.label, onClick: () => options.onAction?.(action.action) } : undefined,
		data: { copyText: presented.detail },
	});
}

/** The only place a failure code becomes user-facing copy; callers choose where it is shown. */
export function presentFailure(failure: DesktopFailure, intl: IntlShape): PresentedFailure {
	const copy = failureCopy[failure.code];
	return {
		title: intl.formatMessage(copy.title),
		description: intl.formatMessage(copy.description),
		detail: failure.detail || undefined,
		actions: failure.action
			? [{ action: failure.action, label: intl.formatMessage(actionLabels[failure.action]) }]
			: [],
	};
}
