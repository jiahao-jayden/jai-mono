import { BubbleChatAddIcon, Delete03Icon, Settings01Icon, Settings05Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SessionInfo } from "@jayden/jai-gateway";
import { MoreHorizontalIcon, PenLine, Search, Settings2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@/components/ui/sidebar";
import { rpc } from "@/lib/rpc";
import { gateway } from "@/services/gateway";
import { useChatStore } from "@/stores/chat";
import { useSessionStore } from "@/stores/session";
import { AppToolbar } from "./app-toolbar";

function SessionItem({
	session,
	isActive,
	onSelect,
	onDelete,
}: {
	session: SessionInfo;
	isActive: boolean;
	onSelect: () => void;
	onDelete: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const { setTitle, updateSessionTitle } = useSessionStore();

	useEffect(() => {
		if (editing) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [editing]);

	const startRename = useCallback(() => {
		const current = session.title || session.firstMessage?.slice(0, 30) || "";
		setDraft(current);
		setEditing(true);
	}, [session]);

	const commit = useCallback(() => {
		setEditing(false);
		const trimmed = draft.trim();
		if (!trimmed || trimmed === session.title) return;

		updateSessionTitle(session.sessionId, trimmed);
		if (isActive) setTitle(trimmed);
		gateway.sessions.update(session.sessionId, { title: trimmed }).catch((err) => {
			console.error("[gateway] rename session failed:", err);
		});
	}, [draft, session, isActive, setTitle, updateSessionTitle]);

	const cancel = useCallback(() => {
		setEditing(false);
	}, []);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter") {
				e.preventDefault();
				commit();
			} else if (e.key === "Escape") {
				cancel();
			}
		},
		[commit, cancel],
	);

	const displayTitle =
		(session.title && session.title.length > 30 ? `${session.title.slice(0, 30)}…` : session.title) ||
		session.firstMessage?.slice(0, 30) ||
		`${session.sessionId.slice(0, 8)}…`;

	if (editing) {
		return (
			<SidebarMenuItem>
				<input
					ref={inputRef}
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={commit}
					onKeyDown={handleKeyDown}
					maxLength={30}
					className="w-full rounded-sm bg-sidebar-accent/50 px-4 py-1.5 text-sm outline-none border border-sidebar-foreground/10 focus:border-sidebar-foreground/25 transition-colors"
				/>
			</SidebarMenuItem>
		);
	}

	return (
		<SidebarMenuItem>
			<SidebarMenuButton
				className="rounded-sm! px-4! group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-primary cursor-pointer"
				isActive={isActive}
				onClick={onSelect}
			>
				<span className="truncate">{displayTitle}</span>
			</SidebarMenuButton>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<SidebarMenuAction showOnHover className="cursor-pointer">
						<MoreHorizontalIcon className="w-4 h-4 text-sidebar-foreground/30 hover:text-sidebar-foreground" />
					</SidebarMenuAction>
				</DropdownMenuTrigger>
				<DropdownMenuContent side="bottom" align="center">
					<DropdownMenuItem
						onSelect={() => {
							setTimeout(startRename, 0);
						}}
					>
						<PenLine className="w-4 h-4" />
						重命名
					</DropdownMenuItem>
					<DropdownMenuItem
						variant="destructive"
						onSelect={() => {
							setTimeout(onDelete, 0);
						}}
					>
						<HugeiconsIcon icon={Delete03Icon} size={16} />
						删除
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</SidebarMenuItem>
	);
}

export function AppSidebar() {
	const { toggleSidebar, open } = useSidebar();
	const { sessions, deleteSession } = useSessionStore();
	const { sessionId: activeSessionId, newChat, loadSession } = useChatStore();
	const [deleteTarget, setDeleteTarget] = useState<SessionInfo | null>(null);

	const confirmDelete = useCallback(() => {
		if (!deleteTarget) return;
		const targetId = deleteTarget.sessionId;
		setDeleteTarget(null);
		requestAnimationFrame(() => {
			deleteSession(targetId);
			if (activeSessionId === targetId) {
				newChat();
			}
		});
	}, [deleteTarget, activeSessionId, newChat, deleteSession]);

	const sorted = [...sessions].sort((a, b) => b.createdAt - a.createdAt);

	return (
		<>
			<Sidebar className="border-none">
				<SidebarHeader className="hidden p-0 md:block">
					<AppToolbar mode="desktop" sidebarIcon="left" onToggleSidebar={toggleSidebar} onNewChat={newChat} />
				</SidebarHeader>

				<SidebarContent className="px-1">
					<motion.div
						animate={{ opacity: open ? 1 : 0 }}
						transition={{ duration: 0.15 }}
						className="flex flex-col flex-1 min-h-0"
					>
						<SidebarGroup className="gap-3">
							<div className="px-2 pt-1 text-base font-serif italic tracking-tight text-sidebar-foreground/80">
								OpenPanda - JAI
							</div>
							<SidebarGroupContent>
								<SidebarMenu>
									<SidebarMenuItem>
										<SidebarMenuButton className="text-sm" onClick={newChat}>
											<HugeiconsIcon icon={BubbleChatAddIcon} size={24} strokeWidth={2} />
											New Chat
										</SidebarMenuButton>
									</SidebarMenuItem>
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>

						{sorted.length > 0 ? (
							<SidebarGroup>
								<SidebarGroupLabel>对话记录</SidebarGroupLabel>
								<SidebarGroupContent>
									<SidebarMenu>
										<AnimatePresence initial={false}>
											{sorted.map((s) => (
												<motion.div
													key={s.sessionId}
													layout
													initial={{ opacity: 0, y: -4 }}
													animate={{ opacity: 1, y: 0 }}
													exit={{ opacity: 0, height: 0, overflow: "hidden" }}
													transition={{ type: "spring", stiffness: 300, damping: 24 }}
												>
													<SessionItem
														session={s}
														isActive={s.sessionId === activeSessionId}
														onSelect={() =>
															loadSession({ sessionId: s.sessionId, title: s.title ?? undefined })
														}
														onDelete={() => setDeleteTarget(s)}
													/>
												</motion.div>
											))}
										</AnimatePresence>
									</SidebarMenu>
								</SidebarGroupContent>
							</SidebarGroup>
						) : (
							<SidebarGroup>
								<SidebarGroupContent>
									<motion.div
										className="flex flex-col items-center gap-1.5 py-10 text-center"
										initial={{ opacity: 0 }}
										animate={{ opacity: 1 }}
										transition={{ duration: 0.2 }}
									>
										<Search className="w-5 h-5 text-sidebar-foreground/20" />
										<p className="text-xs text-sidebar-foreground/40">暂无对话记录</p>
									</motion.div>
								</SidebarGroupContent>
							</SidebarGroup>
						)}
					</motion.div>
				</SidebarContent>

				<SidebarFooter className="border-t border-sidebar-foreground/6">
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton onClick={() => rpc.window.openSettings()}>
								<HugeiconsIcon icon={Settings01Icon} size={16} strokeWidth={1.8} />
								<span>Settings</span>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarFooter>
			</Sidebar>

			<Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>删除对话</DialogTitle>
						<DialogDescription>确定要删除此对话吗？此操作不可撤销。</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setDeleteTarget(null)}>
							取消
						</Button>
						<Button variant="destructive" onClick={confirmDelete}>
							删除
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
