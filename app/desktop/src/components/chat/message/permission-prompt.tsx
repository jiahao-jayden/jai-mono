import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";
import type { PermissionReplyKind } from "@/services/gateway/sessions";
import { type PendingPermissionView, useChatStore, usePendingPermission } from "@/stores/chat";
import type { ToolPermission } from "@/types/chat";

const OUTCOME_LABEL: Record<NonNullable<ToolPermission["outcome"]>, string> = {
	allow_once: "Allowed once",
	allow_session: "Allowed for this session",
	reject: "Skipped",
	aborted: "Cancelled",
};

export function PermissionBar({ className }: { className?: string }) {
	const pending = usePendingPermission();

	return (
		<div className={cn("absolute left-0 right-0 bottom-full px-4 pb-2 pointer-events-none z-10", className)}>
			<AnimatePresence mode="wait" initial={false}>
				{pending ? (
					<motion.div
						key={pending.permission.reqId}
						initial={{ opacity: 0, y: 12, scale: 0.985 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: 8, scale: 0.99, transition: { duration: 0.18 } }}
						transition={{ type: "spring", stiffness: 320, damping: 26 }}
						className="max-w-3xl mx-auto w-full pointer-events-auto"
					>
						<PermissionCard pending={pending} />
					</motion.div>
				) : null}
			</AnimatePresence>
		</div>
	);
}

function PermissionCard({ pending }: { pending: PendingPermissionView }) {
	const sessionId = useChatStore((s) => s.sessionId);
	const [submitting, setSubmitting] = useState<PermissionReplyKind | null>(null);

	async function reply(kind: PermissionReplyKind) {
		if (!sessionId || submitting) return;
		setSubmitting(kind);
		try {
			await gateway.sessions.replyPermission(sessionId, pending.permission.reqId, kind);
		} catch (err) {
			console.error("[permission] reply failed:", err);
			setSubmitting(null);
		}
	}

	return (
		<div
			className={cn(
				"rounded-xl bg-card",
				"border border-primary-2/25 shadow-[0_16px_40px_-12px_rgba(84,100,72,0.30),0_2px_8px_-2px_rgba(84,100,72,0.14)]",
				"px-4 py-3.5",
			)}
		>
			<div className="flex items-baseline gap-2">
				<span aria-hidden className="size-1.5 rounded-full bg-primary-2/70 -translate-y-0.5" />
				<span className="text-[10.5px] font-medium tracking-[0.08em] text-primary-2/80 uppercase">
					Needs your call
				</span>
				<span className="text-[10.5px] text-muted-foreground/40 tracking-wide">·</span>
				<span className="text-[11px] font-medium text-foreground/60">{pending.toolName}</span>
			</div>

			<p className="mt-1.5 text-[13px] leading-relaxed text-foreground/85 wrap-break-word">
				{pending.permission.reason}
			</p>

			<div className="mt-3 flex items-center gap-1.5">
				<Button
					variant="ghost"
					size="sm"
					disabled={submitting !== null}
					onClick={() => reply("reject")}
					className="text-muted-foreground/60 hover:text-foreground/80 hover:bg-muted/50 px-3"
				>
					{submitting === "reject" ? "…" : "Skip"}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={submitting !== null}
					onClick={() => reply("allow_session")}
					className="text-foreground/70 hover:text-foreground hover:bg-muted/50 px-3"
				>
					{submitting === "allow_session" ? "…" : "Allow this session"}
				</Button>
				<div className="flex-1" />
				<Button
					variant="default"
					size="sm"
					disabled={submitting !== null}
					onClick={() => reply("allow_once")}
					className="px-4"
				>
					{submitting === "allow_once" ? "Allowing…" : "Allow once"}
				</Button>
			</div>
		</div>
	);
}

export function PermissionResolvedTrace({ permission }: { permission: ToolPermission }) {
	if (permission.status !== "resolved") return null;
	const label = permission.outcome ? OUTCOME_LABEL[permission.outcome] : "Resolved";
	return (
		<motion.div
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={{ duration: 0.18 }}
			className="ml-5 mt-1 mb-1 flex items-center gap-2 text-[11px] text-muted-foreground/45"
		>
			<span aria-hidden className="size-1 rounded-full bg-primary-2/40" />
			<span>{label}</span>
		</motion.div>
	);
}
