import { Delete02Icon, Edit02Icon, MoreHorizontalIcon, ViewOffSlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { McpServerInfo, McpServerStatus } from "@jayden/jai-gateway";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface McpServerCardProps {
	server: McpServerInfo;
	onEdit?: () => void;
	onToggle?: () => void;
	onRemove?: () => void;
	isToggling?: boolean;
}

export function McpServerCard({ server, onEdit, onToggle, onRemove, isToggling }: McpServerCardProps) {
	const isDisabled = server.status.status === "disabled";
	return (
		<div className="rounded-2xl border border-border/30 bg-card/40 px-5 py-4 transition-colors hover:border-border/55">
			<div className="flex items-start gap-4">
				<StatusDot status={server.status} />
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-2.5 flex-wrap">
						<span className="font-serif text-[15.5px] tracking-tight text-foreground truncate">{server.name}</span>
						<span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground/55">
							{server.transport}
						</span>
						<StatusLabel status={server.status} />
					</div>

					<StatusBody server={server} />

					{server.tools && server.tools.length > 0 && (
						<div className="mt-3 flex flex-wrap gap-1.5">
							{server.tools.map((t) => (
								<span
									key={t}
									className="rounded-md bg-primary-2/10 ring-1 ring-primary-2/15 px-2 py-0.5 font-mono text-[10.5px] text-primary-2"
								>
									{t}
								</span>
							))}
						</div>
					)}
				</div>

				{(onEdit || onToggle || onRemove) && (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								aria-label={`Actions for ${server.name}`}
								disabled={isToggling}
								className="shrink-0 -mr-1 -mt-0.5 rounded-md p-1 text-muted-foreground/55 hover:bg-foreground/5 hover:text-foreground/90 transition-colors disabled:opacity-50"
							>
								<HugeiconsIcon icon={MoreHorizontalIcon} size={16} strokeWidth={1.75} />
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="min-w-40">
							{onEdit && (
								<DropdownMenuItem onSelect={onEdit}>
									<HugeiconsIcon icon={Edit02Icon} size={14} strokeWidth={1.75} />
									Edit
								</DropdownMenuItem>
							)}
							{onToggle && (
								<DropdownMenuItem onSelect={onToggle}>
									<HugeiconsIcon icon={ViewOffSlashIcon} size={14} strokeWidth={1.75} />
									{isDisabled ? "Enable" : "Disable"}
								</DropdownMenuItem>
							)}
							{onRemove && (
								<>
									<DropdownMenuSeparator />
									<DropdownMenuItem variant="destructive" onSelect={onRemove}>
										<HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.75} />
										Remove
									</DropdownMenuItem>
								</>
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</div>
		</div>
	);
}

function StatusBody({ server }: { server: McpServerInfo }) {
	const status = server.status;
	if (status.status === "ready") {
		return (
			<p className="mt-1 text-[12.5px] text-muted-foreground/75 leading-snug">
				{status.toolCount} tool{status.toolCount === 1 ? "" : "s"} ready.
			</p>
		);
	}
	if (status.status === "failed") {
		return (
			<p className="mt-2 font-serif italic text-[12.5px] text-destructive/90 leading-snug break-words">
				{status.error}
			</p>
		);
	}
	if (status.status === "needs_auth") {
		return (
			<div className="mt-2 flex flex-col gap-1.5">
				<p className="text-[12.5px] text-foreground/80 leading-snug">
					This server needs authorization before tools become available.
				</p>
				{status.authUrl && (
					<a
						href={status.authUrl}
						target="_blank"
						rel="noreferrer"
						className="font-mono text-[11.5px] text-primary-2 underline-offset-2 hover:underline truncate"
					>
						Open authorization page
					</a>
				)}
			</div>
		);
	}
	if (status.status === "needs_client_registration") {
		return (
			<p className="mt-2 text-[12.5px] text-foreground/80 leading-snug">
				The auth server requires Dynamic Client Registration. Waiting for client info.
			</p>
		);
	}
	if (status.status === "disabled") {
		return (
			<p className="mt-1 font-serif italic text-[12.5px] text-muted-foreground/60 leading-snug">
				Disabled in settings.
			</p>
		);
	}
	if (status.status === "pending") {
		return (
			<p className="mt-1 font-serif italic text-[12.5px] text-muted-foreground/60 leading-snug">Connecting…</p>
		);
	}
	return null;
}

function StatusDot({ status }: { status: McpServerStatus }) {
	const tone = toneFor(status);
	return (
		<span aria-hidden className="mt-2 flex shrink-0">
			<span
				className={cn(
					"size-2 rounded-full",
					tone === "ok" && "bg-emerald-500",
					tone === "warn" && "bg-amber-500",
					tone === "err" && "bg-rose-500",
					tone === "muted" && "bg-muted-foreground/35",
					tone === "pending" && "bg-sky-500 animate-pulse",
				)}
			/>
		</span>
	);
}

function StatusLabel({ status }: { status: McpServerStatus }) {
	const tone = toneFor(status);
	return (
		<span
			className={cn(
				"rounded-md px-1.5 py-0.5 text-[10.5px] uppercase tracking-[0.12em] font-medium",
				tone === "ok" && "bg-emerald-500/10 text-emerald-600",
				tone === "warn" && "bg-amber-500/10 text-amber-600",
				tone === "err" && "bg-rose-500/10 text-rose-600",
				tone === "muted" && "bg-muted/40 text-muted-foreground/70",
				tone === "pending" && "bg-sky-500/10 text-sky-600",
			)}
		>
			{labelFor(status)}
		</span>
	);
}

function toneFor(status: McpServerStatus): "ok" | "warn" | "err" | "muted" | "pending" {
	switch (status.status) {
		case "ready":
			return "ok";
		case "failed":
			return "err";
		case "needs_auth":
		case "needs_client_registration":
			return "warn";
		case "disabled":
			return "muted";
		case "pending":
			return "pending";
	}
}

function labelFor(status: McpServerStatus): string {
	switch (status.status) {
		case "ready":
			return "ready";
		case "failed":
			return "failed";
		case "needs_auth":
			return "auth";
		case "needs_client_registration":
			return "register";
		case "disabled":
			return "disabled";
		case "pending":
			return "pending";
	}
}
