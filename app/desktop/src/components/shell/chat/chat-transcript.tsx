import type { PermissionResolution } from "@jai/coding/permissions/approval";
import { useState } from "react";
import { useIcons } from "@/lib/icon-context";
import type { DesktopPermissionItem, DesktopTranscriptItem } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { SlashInvocationText } from "./slash-invocation";

export function TranscriptItem({
	item,
	onResolvePermission,
}: {
	item: DesktopTranscriptItem;
	onResolvePermission(resolution: PermissionResolution): Promise<void>;
}) {
	const TerminalIcon = useIcons().terminal;
	if (item.kind === "message") {
		if (item.role === "toolResult") {
			return (
				<div className="mx-1 rounded-lg bg-muted px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-muted-foreground">
					{item.slashInvocation ? (
						<SlashInvocationText text={item.text} invocation={item.slashInvocation} />
					) : (
						item.text
					)}
				</div>
			);
		}
		const user = item.role === "user";
		return (
			<div className={`flex py-1 ${user ? "justify-end" : "justify-start"}`}>
				<div
					className={
						user
							? "max-w-[78%] rounded-[14px] border border-primary-2/10 bg-primary-2/8 px-4 py-2.5 text-[14px] leading-relaxed whitespace-pre-wrap"
							: "max-w-full text-[14px] leading-[1.7] whitespace-pre-wrap text-foreground/95"
					}
				>
					{item.text}
					{item.status === "streaming" ? (
						<span className="ml-1 inline-block h-3.75 w-1.5 animate-pulse rounded-sm bg-primary-2 align-[-2px]" />
					) : null}
				</div>
			</div>
		);
	}

	if (item.kind === "tool") {
		return (
			<div className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-[12px] text-muted-foreground">
				<TerminalIcon size={13} />
				<span className="font-medium text-foreground/75">{item.toolName}</span>
				<span className="min-w-0 flex-1 truncate">{item.summary}</span>
				<span>{item.status}</span>
			</div>
		);
	}

	if (item.kind === "permission") {
		return <PermissionRequest item={item} onResolve={onResolvePermission} />;
	}

	return (
		<div className="flex items-center gap-3 py-2 text-[11.5px] text-muted-foreground">
			<span className="h-px flex-1 bg-border" />
			Context compacted
			<span className="h-px flex-1 bg-border" />
		</div>
	);
}

function PermissionRequest({
	item,
	onResolve,
}: {
	item: DesktopPermissionItem;
	onResolve(resolution: PermissionResolution): Promise<void>;
}) {
	const icons = useIcons();
	const CheckIcon = icons.check;
	const XIcon = icons.x;
	const ShieldAlertIcon = icons["shield-alert"];
	const [resolving, setResolving] = useState(false);
	const [resolveError, setResolveError] = useState<string>();

	if (item.status !== "pending") {
		return (
			<div className="flex items-center gap-2 rounded-[12px] border border-border px-3 py-2 text-[12px] text-muted-foreground">
				{item.status === "allowed" ? <CheckIcon size={14} /> : <XIcon size={14} />}
				Permission {item.status}
			</div>
		);
	}

	const resolve = async (decision: PermissionResolution["decision"]) => {
		if (resolving) return;
		setResolving(true);
		setResolveError(undefined);
		try {
			await onResolve({ requestId: item.request.requestId, decision });
		} catch {
			setResolveError("授权结果未提交，请重试。");
			setResolving(false);
		}
	};

	return (
		<div className="rounded-[14px] border border-border bg-card p-4">
			<div className="flex gap-3">
				<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-2/10 text-primary-2">
					<ShieldAlertIcon size={16} />
				</span>
				<div className="min-w-0">
					<p className="text-[13px] font-semibold">{item.request.summary.title}</p>
					<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
						{item.request.summary.description || item.request.reason}
					</p>
					{item.request.summary.command || item.request.summary.path ? (
						<code className="mt-2 block overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-[11.5px]">
							{item.request.summary.command || item.request.summary.path}
						</code>
					) : null}
				</div>
			</div>
			<div className="mt-3 flex justify-end gap-2">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => void resolve("deny")}
					disabled={resolving}
					className="text-muted-foreground hover:text-foreground"
				>
					Deny
				</Button>
				<Button
					type="button"
					variant="tertiary"
					size="sm"
					onClick={() => void resolve("allowOnce")}
					disabled={resolving}
				>
					{resolving ? "Submitting…" : "Allow once"}
				</Button>
				<Button
					type="button"
					variant="primary"
					size="sm"
					onClick={() => void resolve("alwaysAllow")}
					disabled={resolving}
				>
					Always allow
				</Button>
			</div>
			{resolveError ? <p className="mt-2 text-right text-[11.5px] text-destructive">{resolveError}</p> : null}
		</div>
	);
}

export function TranscriptLoading() {
	return (
		<div className="space-y-4 py-6" role="status" aria-label="Loading conversation">
			<div className="ml-auto h-12 w-56 animate-pulse rounded-[14px] bg-primary-2/8" />
			<div className="h-4 w-[72%] animate-pulse rounded bg-foreground/6" />
			<div className="h-4 w-[58%] animate-pulse rounded bg-foreground/5" />
		</div>
	);
}
