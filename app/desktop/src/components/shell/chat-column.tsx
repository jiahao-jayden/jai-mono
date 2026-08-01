import type { CodingSession, Workspace } from "@jai/coding/business";
import type { PermissionResolution } from "@jai/coding/permissions/approval";
import {
	ArrowUp,
	Check,
	ChevronDown,
	CircleStop,
	Folder,
	PanelRight,
	Plus,
	ShieldAlert,
	Sparkles,
	TerminalSquare,
	X,
} from "lucide-react";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import type { DesktopAgentStatus, DesktopPermissionItem, DesktopTranscriptItem } from "../../../shared/desktop-rpc";

interface ChatColumnProps {
	session?: CodingSession;
	workspace?: Workspace;
	status: DesktopAgentStatus;
	items: readonly DesktopTranscriptItem[];
	loading: boolean;
	error?: string;
	rightPanelOpen: boolean;
	onToggleRightPanel(): void;
	onSend(message: string): Promise<void>;
	onAbort(): Promise<void>;
	onResolvePermission(resolution: PermissionResolution): Promise<void>;
}

export function ChatColumn({
	session,
	workspace,
	status,
	items,
	loading,
	error,
	rightPanelOpen,
	onToggleRightPanel,
	onSend,
	onAbort,
	onResolvePermission,
}: ChatColumnProps) {
	const [draft, setDraft] = useState("");
	const [sending, setSending] = useState(false);
	const [sendError, setSendError] = useState<string>();
	const scrollRef = useRef<HTMLDivElement>(null);
	useTranscriptAutoscroll(scrollRef, items.length, status);

	const submit = async () => {
		const message = draft.trim();
		if (!message || sending) return;
		setSending(true);
		setSendError(undefined);
		try {
			await onSend(message);
			setDraft("");
		} catch {
			setSendError("消息未发送。请检查模型配置后重试。");
		} finally {
			setSending(false);
		}
	};

	const isNewChat = !session;

	return (
		<section className="flex min-w-0 flex-1 flex-col bg-background">
			<header className="flex shrink-0 items-center justify-between px-5 pt-3.5 pb-3">
				<div className="flex min-w-0 items-center gap-2.5 text-[15px]">
					<Folder size={17} className="shrink-0 text-muted-foreground" />
					<span className="max-w-40 truncate font-semibold">{workspace?.displayName ?? "Local"}</span>
					{session ? (
						<>
							<span className="text-muted-foreground/40">/</span>
							<span className="truncate font-semibold">{session.title}</span>
						</>
					) : null}
				</div>
				{session ? (
					<button
						type="button"
						onClick={onToggleRightPanel}
						aria-pressed={rightPanelOpen}
						aria-label={rightPanelOpen ? "Hide task panel" : "Show task panel"}
						title={rightPanelOpen ? "Hide task panel" : "Show task panel"}
						className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					>
						<PanelRight size={16} />
					</button>
				) : (
					<span className="size-8" aria-hidden="true" />
				)}
			</header>

			{isNewChat ? (
				<div className="flex min-h-0 flex-1 items-center justify-center px-8 pb-[8vh]">
					<div className="w-full max-w-[720px]">
						<div className="mb-7 text-center">
							<h1 className="font-serif text-[34px] tracking-[-0.025em] text-foreground">
								{greeting()}, Jiahao
							</h1>
							<p className="mt-2.5 text-[15px] text-muted-foreground">
								Start a chat or hand a task to a local agent.
							</p>
						</div>
						<Composer
							value={draft}
							onValueChange={setDraft}
							onSubmit={submit}
							onAbort={onAbort}
							status={status}
							disabled={sending || status === "running"}
							workspace={workspace}
							large
						/>
						<ComposerError message={sendError || error} />
					</div>
				</div>
			) : (
				<>
					<div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
						<div className="mx-auto flex w-full max-w-[760px] flex-col gap-3 px-8 py-5">
							{loading ? <TranscriptLoading /> : null}
							{!loading && items.length === 0 ? (
								<p className="py-16 text-center text-[13px] text-muted-foreground">这个会话还没有消息。</p>
							) : null}
							{items.map((item) => (
								<TranscriptItem key={item.id} item={item} onResolvePermission={onResolvePermission} />
							))}
							{status === "running" ? (
								<div
									className="flex items-center gap-1.5 px-1 py-2"
									role="status"
									aria-label="Agent is working"
								>
									{[0, 1, 2].map((dot) => (
										<span
											key={dot}
											className="agent-thinking-dot size-1.5 rounded-full bg-primary-2"
											style={{ animationDelay: `${dot * 160}ms` }}
										/>
									))}
								</div>
							) : null}
						</div>
					</div>
					<div className="shrink-0 px-8 pb-3">
						<div className="mx-auto w-full max-w-[760px]">
							<Composer
								value={draft}
								onValueChange={setDraft}
								onSubmit={submit}
								onAbort={onAbort}
								status={status}
								disabled={sending || status === "running"}
								workspace={workspace}
							/>
							<ComposerError message={sendError || error} />
						</div>
					</div>
					<p className="shrink-0 py-2 pb-3 text-center text-[12.5px] text-muted-foreground">
						PandaWork runs on your machine. Agents can make mistakes — double-check outputs.
					</p>
				</>
			)}
		</section>
	);
}

function Composer({
	value,
	onValueChange,
	onSubmit,
	onAbort,
	status,
	disabled,
	workspace,
	large = false,
}: {
	value: string;
	onValueChange(value: string): void;
	onSubmit(): void;
	onAbort(): Promise<void>;
	status: DesktopAgentStatus;
	disabled: boolean;
	workspace?: Workspace;
	large?: boolean;
}) {
	const canSend = value.trim().length > 0 && !disabled;
	const showStop = status === "running";

	return (
		<div className="rounded-[18px] border border-border bg-card shadow-[0_2px_10px_rgba(31,36,33,0.05)]">
			{!large ? (
				<div className="flex h-[46px] items-center gap-[9px] rounded-t-[17px] border-b border-border/70 bg-primary-2/[0.035] px-[18px] text-[13.5px] font-medium tracking-[-0.005em] text-primary-2">
					<Sparkles size={15} />
					{status === "running"
						? `Working in ${workspace?.displayName ?? "this session"}`
						: "Waiting for your lead"}
				</div>
			) : null}
			<div className="px-2 pt-1.5 pb-2">
				<textarea
					value={value}
					onChange={(event) => onValueChange(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							onSubmit();
						}
					}}
					disabled={disabled}
					rows={large ? 2 : 1}
					placeholder={
						status === "running"
							? "Agent is working…"
							: large
								? "What should the agent work on?"
								: "Write a message…"
					}
					aria-label="Message"
					className={`block w-full resize-none bg-transparent px-3 pt-3 pb-1 text-[16px] text-foreground placeholder:text-muted-foreground/80 disabled:opacity-60 ${
						large ? "min-h-[60px]" : "min-h-[44px]"
					}`}
				/>
				<div className="flex items-center justify-between px-1 pt-1">
					<div className="flex min-w-0 items-center gap-1.5">
						<button
							type="button"
							disabled
							aria-label="Attach files"
							title="File attachments are coming later"
							className="flex size-8 shrink-0 cursor-not-allowed items-center justify-center rounded-[9px] border border-border text-foreground/70 opacity-55"
						>
							<Plus size={14} strokeWidth={1.6} />
						</button>
						<button
							type="button"
							disabled
							title="Folder selection is coming later"
							className="flex min-w-0 cursor-not-allowed items-center gap-[7px] rounded-[9px] px-3 py-[7px] text-[13.5px] font-medium text-foreground/80 opacity-65"
						>
							{large ? <Folder size={14} /> : <ShieldAlert size={14} className="text-primary-2" />}
							<span className="truncate">{large ? workspace?.displayName || "Working folder" : "Manual"}</span>
							<ChevronDown size={11} className="shrink-0 opacity-60" />
						</button>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<span
							title="Provider configuration is not available yet"
							className="hidden items-center gap-2 rounded-[9px] px-3 py-[7px] text-[13.5px] font-medium text-foreground/80 min-[900px]:flex"
						>
							<span className="size-[7px] rounded-full bg-primary-2" />
							Model not configured
						</span>
						<button
							type="button"
							onClick={() => (showStop ? void onAbort() : onSubmit())}
							disabled={!showStop && !canSend}
							aria-label={showStop ? "Stop agent" : "Send message"}
							title={showStop ? "Stop agent" : "Send message"}
							className="flex size-[34px] items-center justify-center rounded-[9px] bg-foreground text-background transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-35"
						>
							{showStop ? <CircleStop size={15} /> : <ArrowUp size={15} strokeWidth={1.8} />}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

function TranscriptItem({
	item,
	onResolvePermission,
}: {
	item: DesktopTranscriptItem;
	onResolvePermission(resolution: PermissionResolution): Promise<void>;
}) {
	if (item.kind === "message") {
		if (item.role === "toolResult") {
			return (
				<div className="mx-1 rounded-lg bg-muted px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-muted-foreground">
					{item.text}
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
						<span className="ml-1 inline-block h-[15px] w-1.5 animate-pulse rounded-sm bg-primary-2 align-[-2px]" />
					) : null}
				</div>
			</div>
		);
	}

	if (item.kind === "tool") {
		return (
			<div className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-[12px] text-muted-foreground">
				<TerminalSquare size={13} />
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
	const [resolving, setResolving] = useState(false);
	const [resolveError, setResolveError] = useState<string>();

	if (item.status !== "pending") {
		return (
			<div className="flex items-center gap-2 rounded-[12px] border border-border px-3 py-2 text-[12px] text-muted-foreground">
				{item.status === "allowed" ? <Check size={14} /> : <X size={14} />}
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
					<ShieldAlert size={16} />
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
				<button
					type="button"
					onClick={() => void resolve("deny")}
					disabled={resolving}
					className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-45"
				>
					Deny
				</button>
				<button
					type="button"
					onClick={() => void resolve("allowOnce")}
					disabled={resolving}
					className="rounded-lg border border-border px-3 py-1.5 text-[12px] font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-45"
				>
					{resolving ? "Submitting…" : "Allow once"}
				</button>
				<button
					type="button"
					onClick={() => void resolve("alwaysAllow")}
					disabled={resolving}
					className="rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:pointer-events-none disabled:opacity-45"
				>
					Always allow
				</button>
			</div>
			{resolveError ? <p className="mt-2 text-right text-[11.5px] text-destructive">{resolveError}</p> : null}
		</div>
	);
}

function TranscriptLoading() {
	return (
		<div className="space-y-4 py-6" role="status" aria-label="Loading conversation">
			<div className="ml-auto h-12 w-56 animate-pulse rounded-[14px] bg-primary-2/8" />
			<div className="h-4 w-[72%] animate-pulse rounded bg-foreground/[0.06]" />
			<div className="h-4 w-[58%] animate-pulse rounded bg-foreground/[0.05]" />
		</div>
	);
}

function ComposerError({ message }: { message?: string }) {
	return message ? <p className="mt-2 px-2 text-[12px] text-destructive">{message}</p> : null;
}

function useTranscriptAutoscroll(ref: RefObject<HTMLDivElement | null>, itemCount: number, status: DesktopAgentStatus) {
	useLayoutEffect(() => {
		void itemCount;
		void status;
		const element = ref.current;
		if (!element) return;
		element.scrollTop = element.scrollHeight;
	}, [itemCount, status, ref]);
}

function greeting(): string {
	const hour = new Date().getHours();
	if (hour < 12) return "Good morning";
	if (hour < 18) return "Good afternoon";
	return "Good evening";
}
