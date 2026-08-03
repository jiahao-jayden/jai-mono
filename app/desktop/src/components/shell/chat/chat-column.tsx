import type { CodingSession } from "@jai/coding/business";
import type { PermissionResolution } from "@jai/coding/permissions/approval";
import { type CSSProperties, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { useIcons } from "@/lib/icon-context";
import type {
	DesktopAgentStatus,
	DesktopPermissionItem,
	DesktopProviderConfigSnapshot,
	DesktopTranscriptItem,
	DesktopWorkspace,
} from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectSeparator, SelectTrigger } from "../../ui/select";
import { SlashInvocationText } from "./slash-invocation";
import { WorkspacePicker } from "./workspace-picker";

interface ChatColumnProps {
	session?: CodingSession;
	workspace?: DesktopWorkspace;
	workspaces: readonly DesktopWorkspace[];
	status: DesktopAgentStatus;
	items: readonly DesktopTranscriptItem[];
	loading: boolean;
	error?: string;
	providerConfig?: DesktopProviderConfigSnapshot;
	providerLoading: boolean;
	providerError: boolean;
	modelSwitching: boolean;
	modelSwitchError?: string;
	workspaceBusy: boolean;
	workspaceLoading: boolean;
	workspaceLoadError: boolean;
	workspaceError?: string;
	sidebarOpen: boolean;
	rightPanelOpen: boolean;
	onToggleSidebar(): void;
	onToggleRightPanel(): void;
	onOpenProviderSettings(): void;
	onSelectProviderModel(modelRef: string): Promise<void>;
	onChooseWorkspace(workspace: DesktopWorkspace): Promise<void>;
	onAddWorkspace(): Promise<void>;
	onRetryWorkspaces(): void;
	onSend(message: string): Promise<void>;
	onAbort(): Promise<void>;
	onResolvePermission(resolution: PermissionResolution): Promise<void>;
}

export function ChatColumn({
	session,
	workspace,
	workspaces,
	status,
	items,
	loading,
	error,
	providerConfig,
	providerLoading,
	providerError,
	modelSwitching,
	modelSwitchError,
	workspaceBusy,
	workspaceLoading,
	workspaceLoadError,
	workspaceError,
	sidebarOpen,
	rightPanelOpen,
	onToggleSidebar,
	onToggleRightPanel,
	onOpenProviderSettings,
	onSelectProviderModel,
	onChooseWorkspace,
	onAddWorkspace,
	onRetryWorkspaces,
	onSend,
	onAbort,
	onResolvePermission,
}: ChatColumnProps) {
	const icons = useIcons();
	const FolderIcon = icons.folder;
	const FolderOffIcon = icons["folder-off"];
	const PanelLeftIcon = icons["panel-left-close"];
	const PanelRightIcon = icons["panel-right"];
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

	const workspaceLabel =
		workspace?.displayName ??
		(workspaceLoading ? "Loading workspace…" : workspaceLoadError ? "Workspaces unavailable" : null);

	const drag = { WebkitAppRegion: "drag" } as CSSProperties;
	const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;

	return (
		<section className="flex min-w-0 flex-1 flex-col bg-background">
			<header
				className={`flex h-13 shrink-0 items-center justify-between pr-5 ${sidebarOpen ? "pl-5" : "pl-20"}`}
				style={drag}
			>
				<div className="flex min-w-0 items-center gap-2.5 text-[15px]">
					{!sidebarOpen ? (
						<div className="mr-1 shrink-0" style={noDrag}>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								onClick={onToggleSidebar}
								aria-label="Show sidebar"
								title="Show sidebar"
								className="text-muted-foreground"
							>
								<PanelLeftIcon size={16} />
							</Button>
						</div>
					) : null}
					{workspaceLabel ? (
						<>
							{workspace && !workspace.available ? (
								<FolderOffIcon size={16} className="shrink-0 text-destructive" />
							) : (
								<FolderIcon size={16} className="shrink-0 text-muted-foreground" />
							)}
							<span className="max-w-40 truncate font-semibold">{workspaceLabel}</span>
						</>
					) : null}
					{session ? (
						<>
							{workspaceLabel ? <span className="text-muted-foreground/40">/</span> : null}
							<span className="truncate font-semibold">{session.title}</span>
						</>
					) : null}
				</div>
				<div style={noDrag}>
					{session ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={onToggleRightPanel}
							aria-pressed={rightPanelOpen}
							aria-label={rightPanelOpen ? "Hide task panel" : "Show task panel"}
							title={rightPanelOpen ? "Hide task panel" : "Show task panel"}
							className="shrink-0 text-muted-foreground"
						>
							<PanelRightIcon size={16} />
						</Button>
					) : (
						<span className="size-8" aria-hidden="true" />
					)}
				</div>
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
							disabled={sending || status === "running" || workspace?.available === false}
							workspace={workspace}
							workspaces={workspaces}
							workspaceBusy={workspaceBusy}
							workspaceLoading={workspaceLoading}
							workspaceLoadError={workspaceLoadError}
							onChooseWorkspace={onChooseWorkspace}
							onAddWorkspace={onAddWorkspace}
							onRetryWorkspaces={onRetryWorkspaces}
							providerConfig={providerConfig}
							providerLoading={providerLoading}
							providerError={providerError}
							modelSwitching={modelSwitching}
							onOpenProviderSettings={onOpenProviderSettings}
							onSelectProviderModel={onSelectProviderModel}
							large
						/>
						<ComposerError message={sendError || modelSwitchError || workspaceError || error} />
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
								disabled={sending || status === "running" || workspace?.available === false}
								workspace={workspace}
								workspaces={workspaces}
								workspaceBusy={workspaceBusy}
								workspaceLoading={workspaceLoading}
								workspaceLoadError={workspaceLoadError}
								onChooseWorkspace={onChooseWorkspace}
								onAddWorkspace={onAddWorkspace}
								onRetryWorkspaces={onRetryWorkspaces}
								providerConfig={providerConfig}
								providerLoading={providerLoading}
								providerError={providerError}
								modelSwitching={modelSwitching}
								onOpenProviderSettings={onOpenProviderSettings}
								onSelectProviderModel={onSelectProviderModel}
							/>
							<ComposerError message={sendError || modelSwitchError || workspaceError || error} />
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
	workspaces,
	workspaceBusy,
	workspaceLoading,
	workspaceLoadError,
	onChooseWorkspace,
	onAddWorkspace,
	onRetryWorkspaces,
	providerConfig,
	providerLoading,
	providerError,
	modelSwitching,
	onOpenProviderSettings,
	onSelectProviderModel,
	large = false,
}: {
	value: string;
	onValueChange(value: string): void;
	onSubmit(): void;
	onAbort(): Promise<void>;
	status: DesktopAgentStatus;
	disabled: boolean;
	workspace?: DesktopWorkspace;
	workspaces: readonly DesktopWorkspace[];
	workspaceBusy: boolean;
	workspaceLoading: boolean;
	workspaceLoadError: boolean;
	onChooseWorkspace(workspace: DesktopWorkspace): Promise<void>;
	onAddWorkspace(): Promise<void>;
	onRetryWorkspaces(): void;
	providerConfig?: DesktopProviderConfigSnapshot;
	providerLoading: boolean;
	providerError: boolean;
	modelSwitching: boolean;
	onOpenProviderSettings(): void;
	onSelectProviderModel(modelRef: string): Promise<void>;
	large?: boolean;
}) {
	const icons = useIcons();
	const PlusIcon = icons.plus;
	const StopIcon = icons["stop-circle"];
	const ArrowUpIcon = icons["arrow-up"];
	const SparklesIcon = icons.sparkles;
	const canSend = value.trim().length > 0 && !disabled;
	const showStop = status === "running";
	const modelStatus = resolveModelStatus(providerConfig, providerLoading, providerError);

	return (
		<div>
			<div className="rounded-[18px] border border-border bg-card shadow-surface-3">
				{!large ? (
					<div className="flex h-[46px] items-center gap-[9px] rounded-t-[17px] border-b border-border/70 bg-primary-2/[0.035] px-[18px] text-[13.5px] font-medium tracking-[-0.005em] text-primary-2">
						<SparklesIcon size={15} />
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
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							disabled
							aria-label="Attach files"
							title="File attachments are coming later"
							className="shrink-0"
						>
							<PlusIcon size={14} strokeWidth={1.5} />
						</Button>
						<div className="flex shrink-0 items-center gap-2">
							<div className="hidden min-[900px]:block">
								<ModelSelector
									config={providerConfig}
									status={modelStatus}
									disabled={status === "running" || providerLoading || modelSwitching}
									onSelect={onSelectProviderModel}
									onManage={onOpenProviderSettings}
								/>
							</div>
							<Button
								type="button"
								variant="primary"
								size="icon-sm"
								onClick={() => (showStop ? void onAbort() : onSubmit())}
								disabled={!showStop && !canSend}
								aria-label={showStop ? "Stop agent" : "Send message"}
								title={showStop ? "Stop agent" : "Send message"}
							>
								{showStop ? <StopIcon size={15} /> : <ArrowUpIcon size={15} strokeWidth={1.8} />}
							</Button>
						</div>
					</div>
				</div>
			</div>
			<div className="mt-1.5 pl-2">
				<WorkspacePicker
					workspace={workspace}
					workspaces={workspaces}
					disabled={status === "running"}
					busy={workspaceBusy}
					loading={workspaceLoading}
					loadError={workspaceLoadError}
					onChoose={onChooseWorkspace}
					onAdd={onAddWorkspace}
					onRetry={onRetryWorkspaces}
				/>
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
						<span className="ml-1 inline-block h-[15px] w-1.5 animate-pulse rounded-sm bg-primary-2 align-[-2px]" />
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
	return message ? (
		<p className="mt-2 px-2 text-[12px] text-destructive" role="alert" aria-live="assertive">
			{message}
		</p>
	) : null;
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

const MANAGE_MODELS_VALUE = "__manage-models__";

function ModelSelector({
	config,
	status,
	disabled,
	onSelect,
	onManage,
}: {
	config?: DesktopProviderConfigSnapshot;
	status: { readonly label: string; readonly title: string };
	disabled: boolean;
	onSelect(modelRef: string): Promise<void>;
	onManage(): void;
}) {
	const models =
		config?.profiles.flatMap((profile) =>
			profile.models.map((model) => ({
				ref: `${profile.id}/${model.id}`,
				label: `${profile.name} · ${model.name}`,
			})),
		) ?? [];

	return (
		<Select
			value={config?.activeModelRef ?? ""}
			disabled={disabled}
			onValueChange={(value) => {
				if (value === MANAGE_MODELS_VALUE) {
					onManage();
					return;
				}
				void onSelect(value);
			}}
		>
			<SelectTrigger
				variant="borderless"
				placeholder={status.label}
				title={status.title}
				aria-label={`Model: ${status.label}`}
				className="h-8 min-w-0 max-w-56 px-2 text-[13.5px] font-medium text-foreground/80"
			/>
			<SelectContent className="min-w-64">
				<SelectGroup>
					{models.map((model, index) => (
						<SelectItem key={model.ref} index={index} value={model.ref}>
							{model.label}
						</SelectItem>
					))}
					{models.length > 0 ? <SelectSeparator /> : null}
					<SelectItem index={models.length} value={MANAGE_MODELS_VALUE}>
						Manage models &amp; Providers…
					</SelectItem>
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}

function resolveModelStatus(
	config: DesktopProviderConfigSnapshot | undefined,
	loading: boolean,
	error: boolean,
): { readonly label: string; readonly title: string; readonly configured: boolean } {
	if (loading) return { label: "Loading model…", title: "Loading Provider configuration", configured: false };
	if (error) return { label: "Model unavailable", title: "Open Provider settings to retry", configured: false };
	const modelRef = config?.activeModelRef;
	if (!modelRef) return { label: "Choose model", title: "Configure a Provider and model", configured: false };
	const separator = modelRef.indexOf("/");
	const profileId = modelRef.slice(0, separator);
	const modelId = modelRef.slice(separator + 1);
	const profile = config.profiles.find((candidate) => candidate.id === profileId);
	const model = profile?.models.find((candidate) => candidate.id === modelId);
	const credentialReady = profile?.authentication === "none" || profile?.credentialConfigured === true;
	return {
		label: model?.name ?? modelRef,
		title: credentialReady
			? `${profile?.name ?? profileId} · ${model?.name ?? modelId}`
			: "Provider credential required",
		configured: credentialReady,
	};
}
