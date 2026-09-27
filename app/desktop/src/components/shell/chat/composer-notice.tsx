import { cn } from "cn";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { useIntl } from "react-intl";
import type { ChatNotice } from "@/hooks/use-chat";
import { desktopMessages } from "@/i18n/messages";
import { type DesktopFailureAction, presentFailure } from "@/lib/failure";
import { useIcons } from "@/lib/icon-context";
import type { DesktopFailure } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { CopyButton } from "../../ui/copy-button";

interface ComposerNoticeProps {
	readonly notice: ChatNotice | undefined;
	onDismiss(): void;
	onRetry(): Promise<DesktopFailure | undefined>;
	onReconnect(): void;
	onOpenProviderSettings(): void;
	/** Absent when no project picker is on screen to open. */
	readonly onChooseProject?: () => void;
}

export function ComposerNotice({ notice, ...props }: ComposerNoticeProps) {
	const reducedMotion = useReducedMotion();
	const noticeKey =
		notice?.kind === "connection"
			? `connection:${notice.status}`
			: notice?.kind === "operation"
				? `operation:${notice.operationId}`
				: "send";
	return (
		<AnimatePresence initial={false}>
			{notice ? (
				<motion.div
					key={noticeKey}
					initial={{ opacity: 0, y: 4 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: 4 }}
					transition={{ duration: reducedMotion ? 0 : 0.15, ease: "easeOut" }}
				>
					<ComposerNoticeCard notice={notice} {...props} />
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}

function ComposerNoticeCard({
	notice,
	onDismiss,
	onRetry,
	onReconnect,
	onOpenProviderSettings,
	onChooseProject,
}: ComposerNoticeProps & { readonly notice: ChatNotice }) {
	const intl = useIntl();
	const icons = useIcons();
	const [retrying, setRetrying] = useState(false);
	const [retryRejection, setRetryRejection] = useState<DesktopFailure | undefined>(undefined);
	const failure = noticeFailure(notice);
	const presented = presentFailure(failure, intl);
	const rejection = retryRejection ? presentFailure(retryRejection, intl) : undefined;
	const reconnecting = notice.kind === "connection" && notice.status === "reconnecting";
	const Icon = reconnecting ? icons["rotate-ccw"] : icons["shield-alert"];
	const CloseIcon = icons.x;
	// A suggested action (e.g. fixing credentials) makes a non-retryable failure worth retrying afterwards.
	const canRetry = notice.kind === "operation" && (failure.retryable || failure.action !== undefined);
	const actionHandlers: Partial<Record<DesktopFailureAction, () => void>> = {
		open_provider_settings: onOpenProviderSettings,
		// Only sent when no model is enabled at all, so the selector would be empty; settings is where it is fixed.
		choose_model: onOpenProviderSettings,
		choose_project: onChooseProject,
		reconnect: onReconnect,
	};
	const actions = presented.actions.flatMap((action) => {
		const run = actionHandlers[action.action];
		return run ? [{ ...action, run }] : [];
	});
	const hasFooter = Boolean(presented.detail) || actions.length > 0 || canRetry;

	const retry = async () => {
		setRetrying(true);
		setRetryRejection(await onRetry());
		setRetrying(false);
	};

	return (
		<div
			data-slot="composer-notice"
			role={reconnecting ? "status" : "alert"}
			className="rounded-2xl border border-border-surface bg-surface-primary px-3.5 py-3 text-[13px] leading-normal dark:bg-popover"
		>
			<div className="flex items-start gap-2">
				<Icon
					size={16}
					aria-hidden
					className={cn("mt-0.5 shrink-0 text-amber-600 dark:text-amber-400", {
						"motion-safe:animate-spin": reconnecting,
					})}
				/>
				<div className="min-w-0 flex-1">
					<p className="font-medium text-foreground">{rejection?.title ?? presented.title}</p>
					<p className="mt-0.5 break-words text-muted-foreground">
						{rejection?.description ?? presented.description}
					</p>
				</div>
				{notice.kind === "connection" ? null : (
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="-mt-0.5 -mr-1.5 shrink-0"
						disabled={retrying}
						aria-label={intl.formatMessage(desktopMessages.commonClose)}
						onClick={onDismiss}
					>
						<CloseIcon />
					</Button>
				)}
			</div>
			{hasFooter ? (
				<div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
					{presented.detail ? (
						<CopyButton
							text={presented.detail}
							label={intl.formatMessage(desktopMessages.chatNoticeCopyDetails)}
							disabled={retrying}
						/>
					) : null}
					{actions.map((action) => (
						<Button
							key={action.action}
							type="button"
							variant="tertiary"
							size="sm"
							disabled={retrying}
							onClick={action.run}
						>
							{action.label}
						</Button>
					))}
					{canRetry ? (
						<Button type="button" variant="primary" size="sm" loading={retrying} onClick={() => void retry()}>
							{intl.formatMessage(desktopMessages.commonRetry)}
						</Button>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function noticeFailure(notice: ChatNotice): DesktopFailure {
	if (notice.kind !== "connection") return notice.failure;
	return notice.status === "reconnecting"
		? { code: "connection.reconnecting", retryable: false }
		: { code: "connection.restart_failed", retryable: true, action: "reconnect" };
}
