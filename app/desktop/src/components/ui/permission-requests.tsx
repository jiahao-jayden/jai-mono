"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { fontWeights } from "@/lib/font-weight";
import { useIcon } from "@/lib/icon-context";
import { useShape } from "@/lib/shape-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export type PermissionDecision = "deny" | "allowOnce" | "alwaysAllow";

export interface PermissionRequestView {
	readonly id: string;
	readonly kind?: "permission" | "connector";
	readonly title: string;
	readonly description: string;
	readonly command?: string;
	readonly path?: string;
	readonly actionId?: string;
	readonly inputKeys?: readonly string[];
	readonly canAlwaysAllow: boolean;
}

interface PermissionRequestsProps {
	readonly requests: readonly PermissionRequestView[];
	readonly onResolve: (requestId: string, decision: PermissionDecision) => Promise<void>;
}

const decisions: readonly {
	readonly id: PermissionDecision;
	readonly title: string;
	readonly variant: "ghost" | "tertiary" | "primary";
}[] = [
	{ id: "deny", title: "Deny", variant: "ghost" },
	{ id: "alwaysAllow", title: "Always allow", variant: "tertiary" },
	{ id: "allowOnce", title: "Allow once", variant: "primary" },
];

export function PermissionRequests({ requests, onResolve }: PermissionRequestsProps) {
	const [index, setIndex] = useState(0);
	const [resolving, setResolving] = useState<PermissionDecision>();
	const [resolveError, setResolveError] = useState<string>();
	const shape = useShape();
	const ArrowLeft = useIcon("arrow-left");
	const ArrowRight = useIcon("arrow-right");
	const TerminalIcon = useIcon("terminal");
	const safeIndex = Math.min(index, Math.max(0, requests.length - 1));
	const request = requests[safeIndex];

	if (!request) return null;

	const resolve = async (decision: PermissionDecision) => {
		if (resolving) return;
		setResolving(decision);
		setResolveError(undefined);
		try {
			await onResolve(request.id, decision);
			setResolving(undefined);
		} catch {
			setResolveError("Permission response was not submitted. Try again.");
			setResolving(undefined);
		}
	};

	return (
		<motion.section
			initial={{ opacity: 0, y: 4 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: 3, transition: spring.fast.exit }}
			transition={spring.moderate}
			className={cn("relative mx-auto w-full max-w-155 overflow-hidden border border-border bg-card", shape.container)}
			aria-label="Permission request"
		>
			<header className="flex items-start justify-between gap-3 px-3 pt-3 pb-2">
				<div className="min-w-0">
					<h3
						className="text-[13.5px] leading-snug text-foreground"
						style={{ fontVariationSettings: fontWeights.semibold }}
					>
						{request.title}
					</h3>
					<p className="mt-0.5 truncate text-[11.5px] leading-snug text-muted-foreground">{request.description}</p>
				</div>
				{requests.length > 1 ? (
					<div className="flex shrink-0 items-center gap-0.5 text-[11.5px] text-muted-foreground">
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={() => setIndex((current) => Math.max(0, current - 1))}
							disabled={safeIndex === 0 || Boolean(resolving)}
							aria-label="Previous permission"
						>
							<ArrowLeft size={14} />
						</Button>
						<span className="min-w-8 text-center">
							{safeIndex + 1} of {requests.length}
						</span>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={() => setIndex((current) => Math.min(requests.length - 1, current + 1))}
							disabled={safeIndex === requests.length - 1 || Boolean(resolving)}
							aria-label="Next permission"
						>
							<ArrowRight size={14} />
						</Button>
					</div>
				) : null}
			</header>

			{request.command || request.path || request.actionId ? (
				<div className="mx-3 mb-1.5 flex items-start gap-2 rounded-lg bg-muted/70 px-2.5 py-1.5">
					<TerminalIcon size={12} className="mt-0.5 shrink-0 text-muted-foreground" />
					<code className="line-clamp-2 min-w-0 font-mono text-[11px] leading-relaxed text-muted-foreground">
						{request.command || request.path || request.actionId}
					</code>
				</div>
			) : null}

			{resolveError ? (
				<p className="px-3 pb-1 text-[11.5px] text-destructive" role="alert">
					{resolveError}
				</p>
			) : null}
			<div className="flex flex-wrap justify-end gap-1.5 px-3 pt-1 pb-3">
				{decisions.filter((decision) => decision.id !== "alwaysAllow" || request.canAlwaysAllow).map((decision) => (
					<Button
						key={decision.id}
						type="button"
						variant={decision.variant}
						size="sm"
						disabled={Boolean(resolving)}
						loading={resolving === decision.id}
						onClick={() => void resolve(decision.id)}
					>
						{decision.title}
					</Button>
				))}
			</div>
		</motion.section>
	);
}
