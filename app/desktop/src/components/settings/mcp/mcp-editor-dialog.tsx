import type { McpServerConfig, McpStatusResponse } from "@jayden/jai-gateway";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";

interface McpEditorDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	mode: "add" | "edit";
	initialName?: string;
	initialConfig?: McpServerConfig;
}

const NAME_RE = /^[a-zA-Z0-9_.-]+$/;

const STDIO_EXAMPLE = `{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-everything"]
}`;

const HTTP_EXAMPLE = `{
  "url": "https://mcp.example.com/sse",
  "headers": { "Authorization": "Bearer xxx" }
}`;

type LocalErr = { kind: "name" | "json" | "shape"; msg: string };

function validateLocally(name: string, jsonText: string, isEdit: boolean): LocalErr | null {
	const trimmed = name.trim();
	if (!isEdit) {
		if (!trimmed) return { kind: "name", msg: "Name is required" };
		if (trimmed.length > 64) return { kind: "name", msg: "Name must be ≤ 64 characters" };
		if (!NAME_RE.test(trimmed))
			return { kind: "name", msg: "Only letters, digits, '.', '-', '_' allowed" };
	}

	if (!jsonText.trim()) return { kind: "json", msg: "Config JSON is required" };

	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonText);
	} catch (e) {
		return { kind: "json", msg: e instanceof Error ? e.message : "Invalid JSON" };
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { kind: "shape", msg: "Config must be a JSON object" };
	}
	const obj = parsed as Record<string, unknown>;
	const hasCmd = typeof obj.command === "string" && obj.command.length > 0;
	const hasUrl = typeof obj.url === "string" && obj.url.length > 0;
	if (!hasCmd && !hasUrl) {
		return { kind: "shape", msg: "Config must contain either `command` (stdio) or `url` (http/sse)" };
	}
	if (hasCmd && hasUrl) {
		return { kind: "shape", msg: "Config cannot have both `command` and `url`" };
	}
	return null;
}

function detectTransport(jsonText: string): "stdio" | "http" | null {
	try {
		const obj = JSON.parse(jsonText);
		if (obj && typeof obj === "object") {
			if (typeof (obj as any).command === "string") return "stdio";
			if (typeof (obj as any).url === "string") return "http";
		}
	} catch {
		// ignore
	}
	return null;
}

export function McpEditorDialog({
	open,
	onOpenChange,
	mode,
	initialName = "",
	initialConfig,
}: McpEditorDialogProps) {
	const isEdit = mode === "edit";
	const [name, setName] = useState(initialName);
	const [jsonText, setJsonText] = useState(() =>
		initialConfig ? JSON.stringify(initialConfig, null, 2) : STDIO_EXAMPLE,
	);
	const [serverError, setServerError] = useState<string | null>(null);

	useEffect(() => {
		if (open) {
			setName(initialName);
			setJsonText(initialConfig ? JSON.stringify(initialConfig, null, 2) : STDIO_EXAMPLE);
			setServerError(null);
		}
	}, [open, initialName, initialConfig]);

	const localErr = useMemo(() => validateLocally(name, jsonText, isEdit), [name, jsonText, isEdit]);
	const transport = useMemo(() => detectTransport(jsonText), [jsonText]);

	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: async () => {
			const config = JSON.parse(jsonText) as McpServerConfig;
			return gateway.mcp.upsert(name.trim(), config);
		},
		onSuccess: (next: McpStatusResponse) => {
			queryClient.setQueryData(["mcp", "status"], next);
			queryClient.invalidateQueries({ queryKey: ["mcp", "configs"] });
			const target = next.servers.find((s) => s.name === name.trim());
			describeOutcome(name.trim(), target);
			onOpenChange(false);
		},
		onError: (err: unknown) => {
			const msg = extractErrorMessage(err);
			setServerError(msg);
		},
	});

	const canSubmit = !localErr && !mutation.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{isEdit ? `Edit ${initialName}` : "Add MCP server"}</DialogTitle>
					<DialogDescription>
						Paste a JSON snippet from a marketplace or write your own. Servers with{" "}
						<code className="font-mono text-[11.5px]">command</code> use stdio; servers with{" "}
						<code className="font-mono text-[11.5px]">url</code> use Streamable HTTP (with SSE fallback).
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-1.5">
						<Label className="text-[12.5px] text-foreground/80">Name</Label>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="filesystem"
							disabled={isEdit}
							className={cn(
								"font-mono text-[13px]",
								localErr?.kind === "name" && "border-destructive focus-visible:ring-destructive/30",
							)}
						/>
						{localErr?.kind === "name" && (
							<p className="text-[11.5px] text-destructive/90">{localErr.msg}</p>
						)}
						{!isEdit && !localErr && (
							<p className="text-[11.5px] text-muted-foreground/70">
								Used as tool prefix:{" "}
								<code className="font-mono">mcp__{name.trim() || "<name>"}__&lt;tool&gt;</code>
							</p>
						)}
					</div>

					<div className="space-y-1.5">
						<div className="flex items-baseline justify-between gap-2">
							<Label className="text-[12.5px] text-foreground/80">Config JSON</Label>
							<div className="flex items-center gap-2">
								{transport && (
									<span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground/65">
										detected: {transport}
									</span>
								)}
								<button
									type="button"
									onClick={() => setJsonText(STDIO_EXAMPLE)}
									className="text-[11.5px] text-muted-foreground/75 hover:text-foreground transition-colors"
								>
									stdio example
								</button>
								<span className="text-[11px] text-muted-foreground/40">·</span>
								<button
									type="button"
									onClick={() => setJsonText(HTTP_EXAMPLE)}
									className="text-[11.5px] text-muted-foreground/75 hover:text-foreground transition-colors"
								>
									http example
								</button>
							</div>
						</div>
						<textarea
							value={jsonText}
							onChange={(e) => setJsonText(e.target.value)}
							spellCheck={false}
							rows={10}
							className={cn(
								"w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-[12.5px] leading-relaxed text-foreground/90 outline-none",
								"focus-visible:ring-2 focus-visible:ring-ring/40",
								localErr?.kind === "json" || localErr?.kind === "shape"
									? "border-destructive focus-visible:ring-destructive/30"
									: "border-border/55",
							)}
						/>
						{(localErr?.kind === "json" || localErr?.kind === "shape") && (
							<p className="text-[11.5px] text-destructive/90 break-words">{localErr.msg}</p>
						)}
					</div>

					{serverError && (
						<div className="rounded-md bg-destructive/10 ring-1 ring-destructive/25 px-3 py-2">
							<p className="text-[12px] text-destructive break-words">{serverError}</p>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
						Cancel
					</Button>
					<Button onClick={() => mutation.mutate()} disabled={!canSubmit}>
						{mutation.isPending ? "Saving…" : isEdit ? "Save & reload" : "Add & connect"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function describeOutcome(
	name: string,
	server: McpStatusResponse["servers"][number] | undefined,
): void {
	if (!server) {
		toast.success(`Saved ${name}`);
		return;
	}
	const s = server.status;
	switch (s.status) {
		case "ready":
			toast.success(`${name} connected (${s.toolCount} tool${s.toolCount === 1 ? "" : "s"})`);
			return;
		case "needs_auth":
			toast.warning(`${name} saved — authorization required`);
			return;
		case "needs_client_registration":
			toast.warning(`${name} saved — auth server requires Dynamic Client Registration`);
			return;
		case "failed":
			toast.error(`${name}: ${s.error}`);
			return;
		case "disabled":
			toast.message(`${name} saved (disabled)`);
			return;
		case "pending":
			toast.message(`${name} saved — connecting…`);
			return;
	}
}

function extractErrorMessage(err: unknown): string {
	if (!err) return "Unknown error";
	const anyErr = err as { data?: { error?: string; issues?: unknown[] }; message?: string };
	if (anyErr.data?.error) {
		const issues = anyErr.data.issues;
		if (Array.isArray(issues) && issues.length > 0) {
			const first = issues[0] as { path?: unknown[]; message?: string };
			const path = Array.isArray(first.path) && first.path.length > 0 ? first.path.join(".") : "";
			return path ? `${anyErr.data.error}: ${path} — ${first.message ?? ""}` : anyErr.data.error;
		}
		return anyErr.data.error;
	}
	return anyErr.message ?? String(err);
}
