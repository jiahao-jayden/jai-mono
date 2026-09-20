import { cn } from "cn";
import { useCallback, useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { Button } from "@/components/ui/button";
import { desktopMessages } from "@/i18n/messages";
import { desktop } from "@/lib/desktop";
import { useIcons } from "@/lib/icon-context";
import type { DesktopWorkspaceGitChange, DesktopWorkspaceGitStatus } from "../../../shared/desktop-rpc";

type ChangesState =
	| { readonly status: "loading" }
	| { readonly status: "error" }
	| { readonly status: "ready"; readonly value: DesktopWorkspaceGitStatus };

export function WorkspaceChanges({
	sessionId,
	onOpenReview,
}: {
	readonly sessionId: string;
	onOpenReview(path: string): void;
}) {
	const intl = useIntl();
	const icons = useIcons();
	const RefreshIcon = icons["rotate-ccw"];
	const FileIcon = icons["file-edit"];
	const FolderOffIcon = icons["folder-off"];
	const generationRef = useRef(0);
	const [state, setState] = useState<ChangesState>({ status: "loading" });

	const refresh = useCallback(async () => {
		const generation = generationRef.current + 1;
		generationRef.current = generation;
		setState({ status: "loading" });
		try {
			const value = await desktop.workspace.gitStatus({ sessionId });
			if (generationRef.current === generation) setState({ status: "ready", value });
		} catch {
			if (generationRef.current === generation) setState({ status: "error" });
		}
	}, [sessionId]);

	useEffect(() => {
		void refresh();
		return () => {
			generationRef.current += 1;
		};
	}, [refresh]);

	useEffect(() => {
		const handleFocus = () => void refresh();
		window.addEventListener("focus", handleFocus);
		return () => window.removeEventListener("focus", handleFocus);
	}, [refresh]);

	const repository = state.status === "ready" && state.value.kind === "repository" ? state.value : null;
	const refreshLabel = intl.formatMessage(desktopMessages.workspaceChangesRefresh);
	return (
		<section
			className="flex h-full min-h-0 flex-col"
			aria-label={intl.formatMessage(desktopMessages.workspaceChanges)}
		>
			<div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
				<div className="min-w-0 flex-1">
					<p className="truncate text-[12px] font-medium text-foreground">
						{repository?.rootName ?? intl.formatMessage(desktopMessages.workspaceChanges)}
					</p>
					{repository ? (
						<p className="truncate text-[10px] text-muted-foreground">
							{repository.detached
								? intl.formatMessage(desktopMessages.workspaceDetachedHead)
								: (repository.branch ?? intl.formatMessage(desktopMessages.workspaceNoBranch))}
						</p>
					) : null}
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					disabled={state.status === "loading"}
					aria-label={refreshLabel}
					title={refreshLabel}
					onClick={() => void refresh()}
					className="shrink-0 text-muted-foreground"
				>
					<RefreshIcon size={14} className={cn({ "animate-spin": state.status === "loading" })} />
				</Button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{state.status === "loading" ? (
					<ChangesEmpty
						icon={RefreshIcon}
						message={intl.formatMessage(desktopMessages.workspaceChangesLoading)}
						spin
					/>
				) : state.status === "error" ? (
					<ChangesEmpty icon={FolderOffIcon} message={intl.formatMessage(desktopMessages.workspaceChangesError)} />
				) : state.value.kind === "not-repository" ? (
					<ChangesEmpty
						icon={FolderOffIcon}
						message={intl.formatMessage(desktopMessages.workspaceNotRepository)}
					/>
				) : state.value.changes.length === 0 ? (
					<ChangesEmpty icon={FileIcon} message={intl.formatMessage(desktopMessages.workspaceChangesEmpty)} />
				) : (
					<ul className="divide-y divide-border/70 py-1">
						{state.value.changes.map((change) => (
							<ChangeRow key={change.path} change={change} onOpen={() => onOpenReview(change.path)} />
						))}
					</ul>
				)}
			</div>
		</section>
	);
}

function ChangeRow({ change, onOpen }: { readonly change: DesktopWorkspaceGitChange; onOpen(): void }) {
	const intl = useIntl();
	const statusLabel = intl.formatMessage(desktopMessages.workspaceChangeStatus, { status: change.kind });
	return (
		<li>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				onClick={onOpen}
				className="h-auto min-h-11 w-full justify-start rounded-none px-3 py-2 font-normal"
				contentClassName="w-full min-w-0 justify-start gap-3"
			>
				<span
					className="flex size-6 shrink-0 items-center justify-center rounded bg-surface-tertiary font-mono text-[10px] font-semibold text-muted-foreground"
					aria-hidden="true"
					title={statusLabel}
				>
					{statusCode(change.kind)}
				</span>
				<span className="sr-only">{statusLabel}</span>
				<span className="min-w-0 flex-1 text-left">
					<span className="block truncate text-[12px] text-foreground" title={change.path}>
						{change.path}
					</span>
					{change.oldPath ? (
						<span className="block truncate text-[10px] text-muted-foreground" title={change.oldPath}>
							{change.oldPath}
						</span>
					) : null}
				</span>
				<span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
					{change.staged ? <span>{intl.formatMessage(desktopMessages.workspaceChangeStaged)}</span> : null}
					{change.staged && change.unstaged ? <span aria-hidden="true">·</span> : null}
					{change.unstaged ? <span>{intl.formatMessage(desktopMessages.workspaceChangeUnstaged)}</span> : null}
				</span>
			</Button>
		</li>
	);
}

function ChangesEmpty({
	icon: Icon,
	message,
	spin = false,
}: {
	readonly icon: ReturnType<typeof useIcons>["folder"];
	readonly message: string;
	readonly spin?: boolean;
}) {
	return (
		<div className="flex h-full min-h-64 flex-col items-center justify-center px-6 text-center text-muted-foreground">
			<Icon size={22} className={cn({ "animate-spin": spin })} />
			<p className="mt-3 text-[12px] leading-5">{message}</p>
		</div>
	);
}

function statusCode(kind: DesktopWorkspaceGitChange["kind"]): string {
	switch (kind) {
		case "added":
			return "A";
		case "conflict":
			return "U";
		case "deleted":
			return "D";
		case "modified":
			return "M";
		case "renamed":
			return "R";
		case "untracked":
			return "?";
	}
}
