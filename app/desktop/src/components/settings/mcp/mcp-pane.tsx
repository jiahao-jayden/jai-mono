import { Add01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { McpServerConfig, McpStatusResponse } from "@jayden/jai-gateway";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { gateway } from "@/services/gateway";
import { SettingsHeader, SettingsPage } from "../common/settings-layout";
import { McpEditorDialog } from "./mcp-editor-dialog";
import { McpServerCard } from "./mcp-server-card";

type EditorState =
	| { open: false }
	| { open: true; mode: "add" }
	| { open: true; mode: "edit"; name: string; config: McpServerConfig };

export function McpPane() {
	const queryClient = useQueryClient();

	const status = useQuery({
		queryKey: ["mcp", "status"],
		queryFn: () => gateway.mcp.status(),
		refetchInterval: 5000,
	});

	const configs = useQuery({
		queryKey: ["mcp", "configs"],
		queryFn: () => gateway.mcp.listConfigs(),
	});

	const [editor, setEditor] = useState<EditorState>({ open: false });
	const [pendingRemove, setPendingRemove] = useState<string | null>(null);
	const [togglingName, setTogglingName] = useState<string | null>(null);

	const reload = useMutation({
		mutationFn: () => gateway.mcp.reload(),
		onSuccess: (next: McpStatusResponse) => {
			queryClient.setQueryData(["mcp", "status"], next);
			toast.success("Reloaded MCP servers");
		},
	});

	const toggle = useMutation({
		mutationFn: async (name: string) => {
			const cfg = configs.data?.servers[name];
			if (!cfg) throw new Error(`Config not found for ${name}`);
			setTogglingName(name);
			const enabled = cfg.enabled === false ? true : false;
			return gateway.mcp.upsert(name, { ...cfg, enabled });
		},
		onSuccess: (next: McpStatusResponse, name: string) => {
			queryClient.setQueryData(["mcp", "status"], next);
			queryClient.invalidateQueries({ queryKey: ["mcp", "configs"] });
			const nextCfg = next.servers.find((s) => s.name === name);
			toast.success(nextCfg?.status.status === "disabled" ? `Disabled ${name}` : `Enabled ${name}`);
		},
		onError: (err: unknown, name: string) => {
			toast.error(`Toggle failed for ${name}: ${err instanceof Error ? err.message : String(err)}`);
		},
		onSettled: () => setTogglingName(null),
	});

	const remove = useMutation({
		mutationFn: (name: string) => gateway.mcp.remove(name),
		onSuccess: (next: McpStatusResponse, name: string) => {
			queryClient.setQueryData(["mcp", "status"], next);
			queryClient.invalidateQueries({ queryKey: ["mcp", "configs"] });
			toast.success(`Removed ${name}`);
		},
		onError: (err: unknown, name: string) => {
			toast.error(`Remove failed for ${name}: ${err instanceof Error ? err.message : String(err)}`);
		},
		onSettled: () => setPendingRemove(null),
	});

	const servers = status.data?.servers ?? [];
	const hasServers = servers.length > 0;
	const rawConfigs = configs.data?.servers ?? {};

	return (
		<SettingsPage>
			<SettingsHeader
				title="MCP Servers"
				description={
					<>
						External tools exposed to the model via the Model Context Protocol (stdio, Streamable HTTP, or SSE).
						Add servers manually or paste a JSON snippet from a marketplace.
					</>
				}
				action={
					<div className="flex items-center gap-1.5">
						<button
							type="button"
							onClick={() => reload.mutate()}
							disabled={reload.isPending}
							className="inline-flex items-center gap-1.5 rounded-md border border-border/40 bg-card/60 px-2.5 py-1 text-[12px] text-foreground/80 hover:border-border/70 hover:text-foreground transition-colors disabled:opacity-50"
						>
							<HugeiconsIcon
								icon={Refresh01Icon}
								size={12}
								strokeWidth={1.75}
								className={reload.isPending ? "animate-spin" : undefined}
							/>
							<span>Reload</span>
						</button>
						<button
							type="button"
							onClick={() => setEditor({ open: true, mode: "add" })}
							className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-2.5 py-1 text-[12px] hover:bg-primary/90 transition-colors"
						>
							<HugeiconsIcon icon={Add01Icon} size={12} strokeWidth={1.75} />
							<span>Add server</span>
						</button>
					</div>
				}
			/>

			{status.isLoading && <McpLoading />}
			{status.isError && (
				<McpError message={status.error instanceof Error ? status.error.message : String(status.error)} />
			)}
			{!status.isLoading && !status.isError && !hasServers && (
				<McpEmpty onAdd={() => setEditor({ open: true, mode: "add" })} />
			)}
			{!status.isLoading && !status.isError && hasServers && (
				<ul className="space-y-2.5">
					{servers.map((s) => {
						const cfg = rawConfigs[s.name];
						return (
							<li key={s.name}>
								<McpServerCard
									server={s}
									isToggling={togglingName === s.name}
									onEdit={
										cfg
											? () => setEditor({ open: true, mode: "edit", name: s.name, config: cfg })
											: undefined
									}
									onToggle={cfg ? () => toggle.mutate(s.name) : undefined}
									onRemove={() => setPendingRemove(s.name)}
								/>
							</li>
						);
					})}
				</ul>
			)}

			{editor.open && (
				<McpEditorDialog
					open={editor.open}
					onOpenChange={(open) => !open && setEditor({ open: false })}
					mode={editor.mode}
					initialName={editor.mode === "edit" ? editor.name : ""}
					initialConfig={editor.mode === "edit" ? editor.config : undefined}
				/>
			)}

			<AlertDialog open={pendingRemove !== null} onOpenChange={(o) => !o && setPendingRemove(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove MCP server?</AlertDialogTitle>
						<AlertDialogDescription>
							{pendingRemove && (
								<>
									<code className="font-mono text-[13px]">{pendingRemove}</code> and its tools will be removed.
									This change is written to your global settings file.
								</>
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							disabled={remove.isPending}
							onClick={(e) => {
								e.preventDefault();
								if (pendingRemove) remove.mutate(pendingRemove);
							}}
						>
							{remove.isPending ? "Removing…" : "Remove"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</SettingsPage>
	);
}

function McpLoading() {
	return (
		<ul className="space-y-2.5" aria-busy="true">
			{[0, 1].map((i) => (
				<li key={i} className="rounded-2xl bg-card/50 ring-1 ring-border/40 px-5 py-4">
					<div className="h-4 w-40 rounded bg-muted/50 animate-pulse" />
					<div className="mt-2.5 h-3 w-64 rounded bg-muted/30 animate-pulse" />
				</li>
			))}
		</ul>
	);
}

function McpError({ message }: { message: string }) {
	return (
		<div className="rounded-2xl bg-card/50 ring-1 ring-border/40 px-5 py-5">
			<p className="text-[13px] text-foreground/80">无法加载 MCP servers 状态</p>
			<p className="mt-1.5 font-serif italic text-[12.5px] text-muted-foreground/70">{message}</p>
		</div>
	);
}

function McpEmpty({ onAdd }: { onAdd: () => void }) {
	return (
		<div className="rounded-2xl bg-card/50 ring-1 ring-border/40 px-6 py-8 text-center">
			<p className="font-serif italic text-[14px] text-foreground/75">No MCP servers configured.</p>
			<p className="mt-1.5 text-[12.5px] text-muted-foreground/70">
				Click <span className="text-foreground/85">Add server</span> above to paste a config from a marketplace.
			</p>
			<button
				type="button"
				onClick={onAdd}
				className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-[12.5px] hover:bg-primary/90 transition-colors"
			>
				Add your first server
			</button>
		</div>
	);
}
