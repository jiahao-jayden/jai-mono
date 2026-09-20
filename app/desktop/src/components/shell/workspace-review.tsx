import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { Button } from "@/components/ui/button";
import { desktopMessages } from "@/i18n/messages";
import { desktop } from "@/lib/desktop";
import { useIcons } from "@/lib/icon-context";
import { useResolvedTheme } from "@/stores/theme";
import type { DesktopWorkspaceGitDiff } from "../../../shared/desktop-rpc";

type ReviewState =
	| { readonly status: "loading" }
	| { readonly status: "error" }
	| { readonly status: "ready"; readonly value: DesktopWorkspaceGitDiff };

const DIFF_UNSAFE_CSS = `
:host {
  --diffs-font-family: var(--font-mono);
  --diffs-header-font-family: var(--font-sans);
  --diffs-font-size: 11px;
  --diffs-bg: var(--background);
  --diffs-light-bg: var(--background);
  --diffs-dark-bg: var(--background);
  --diffs-bg-context-override: var(--background);
  --diffs-bg-context-number-override: var(--background);
  --diffs-bg-addition-override: color-mix(in oklab, var(--background) 90%, var(--success));
  --diffs-bg-deletion-override: color-mix(in oklab, var(--background) 90%, var(--destructive));
  background: var(--background);
}
`;

export function WorkspaceReview({
	sessionId,
	path,
	onBack,
}: {
	readonly sessionId: string;
	readonly path: string;
	onBack(): void;
}) {
	const intl = useIntl();
	const icons = useIcons();
	const theme = useResolvedTheme();
	const ArrowLeftIcon = icons["arrow-left"];
	const FileIcon = icons["file-search"];
	const LoadingIcon = icons.loader;
	const generationRef = useRef(0);
	const [state, setState] = useState<ReviewState>({ status: "loading" });

	useEffect(() => {
		const generation = generationRef.current + 1;
		generationRef.current = generation;
		setState({ status: "loading" });
		void desktop.workspace
			.gitDiff({ sessionId, path })
			.then((value) => {
				if (generationRef.current === generation) setState({ status: "ready", value });
			})
			.catch(() => {
				if (generationRef.current === generation) setState({ status: "error" });
			});
		return () => {
			generationRef.current += 1;
		};
	}, [path, sessionId]);

	const textDiff = state.status === "ready" && state.value.kind === "text" ? state.value : null;
	const fileDiff = useMemo(() => {
		if (!textDiff) return null;
		const oldName = textDiff.oldPath ?? textDiff.path;
		return parseDiffFromFile(
			textDiff.oldContent === null ? null : { name: oldName, contents: textDiff.oldContent },
			textDiff.newContent === null ? null : { name: textDiff.path, contents: textDiff.newContent },
		);
	}, [textDiff]);
	const backLabel = intl.formatMessage(desktopMessages.workspaceReviewBack);
	const statusText = textDiff
		? intl.formatMessage(desktopMessages.workspaceChangeStatus, { status: textDiff.changeKind })
		: null;
	const unavailableMessage =
		state.status === "ready" && state.value.kind === "unavailable"
			? unavailableReasonMessage(state.value.reason, intl)
			: null;
	const unavailableEmptyMessage = unavailableMessage ?? "";
	const diffTheme = theme === "dark" ? "github-dark" : "github-light";
	const diffOptions = {
		diffStyle: "unified" as const,
		lineDiffType: "word" as const,
		overflow: "scroll" as const,
		theme: diffTheme,
		themeType: theme,
		disableFileHeader: true,
		unsafeCSS: DIFF_UNSAFE_CSS,
	};

	return (
		<section
			className="flex h-full min-h-0 flex-col"
			aria-label={intl.formatMessage(desktopMessages.workspaceReview)}
		>
			<div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					onClick={onBack}
					aria-label={backLabel}
					title={backLabel}
					className="shrink-0 text-muted-foreground"
				>
					<ArrowLeftIcon size={14} />
				</Button>
				<div className="min-w-0 flex-1">
					<p className="truncate text-[12px] font-medium text-foreground" title={path}>
						{path}
					</p>
					{statusText ? <p className="text-[10px] text-muted-foreground">{statusText}</p> : null}
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-auto">
				{state.status === "loading" ? (
					<ReviewEmpty icon={LoadingIcon} message={intl.formatMessage(desktopMessages.workspaceReviewLoading)} />
				) : state.status === "error" ? (
					<ReviewEmpty icon={FileIcon} message={intl.formatMessage(desktopMessages.workspaceReviewError)} />
				) : state.value.kind === "not-changed" ? (
					<ReviewEmpty icon={FileIcon} message={intl.formatMessage(desktopMessages.workspaceReviewNotChanged)} />
				) : state.value.kind === "unavailable" ? (
					<ReviewEmpty icon={FileIcon} message={unavailableEmptyMessage} />
				) : fileDiff ? (
					<FileDiff key={theme} fileDiff={fileDiff} options={diffOptions} className="min-w-full" />
				) : null}
			</div>
		</section>
	);
}

function ReviewEmpty({
	icon: Icon,
	message,
}: {
	readonly icon: ReturnType<typeof useIcons>["folder"];
	readonly message: string;
}) {
	return (
		<div className="flex h-full min-h-64 flex-col items-center justify-center px-6 text-center text-muted-foreground">
			<Icon size={22} />
			<p className="mt-3 max-w-80 text-[12px] leading-5">{message}</p>
		</div>
	);
}

function unavailableReasonMessage(
	reason: Extract<DesktopWorkspaceGitDiff, { readonly kind: "unavailable" }>["reason"],
	intl: ReturnType<typeof useIntl>,
): string {
	switch (reason) {
		case "binary":
			return intl.formatMessage(desktopMessages.workspaceReviewBinary);
		case "invalid-encoding":
			return intl.formatMessage(desktopMessages.workspaceReviewInvalidEncoding);
		case "missing":
			return intl.formatMessage(desktopMessages.workspaceReviewMissing);
		case "submodule":
			return intl.formatMessage(desktopMessages.workspaceReviewSubmodule);
		case "too-large":
			return intl.formatMessage(desktopMessages.workspaceReviewTooLarge);
	}
}
