import { PanelLeftIcon, PenLine, Search, Settings2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { gateway } from "@/lib/gateway-client";
import { windowClient } from "@/lib/ipc-client";
import type { SessionInfo } from "@/types/chat";
import { Titlebar, ToolbarButton } from "./titlebar";

interface AppSidebarProps {
	activeSessionId?: string | null;
	onNewChat?: () => void;
	onSelectSession?: (session: { sessionId: string; title?: string }) => void;
}

export function AppSidebar({ activeSessionId, onNewChat, onSelectSession }: AppSidebarProps) {
	const { open, setOpen } = useSidebar();
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [deleteTarget, setDeleteTarget] = useState<SessionInfo | null>(null);

	const loadSessions = useCallback(async () => {
		try {
			const list = await gateway.listSessions();
			setSessions(list);
		} catch {
			/* gateway not ready yet */
		}
	}, []);

	useEffect(() => {
		loadSessions();
		const timer = setInterval(loadSessions, 5000);
		return () => clearInterval(timer);
	}, [loadSessions]);

	const confirmDelete = useCallback(async () => {
		if (!deleteTarget) return;
		try {
			await gateway.deleteSession(deleteTarget.sessionId);
			setSessions((prev) => prev.filter((s) => s.sessionId !== deleteTarget.sessionId));
			if (activeSessionId === deleteTarget.sessionId) {
				onNewChat?.();
			}
		} catch (err) {
			console.error("[gateway] deleteSession failed:", err);
		} finally {
			setDeleteTarget(null);
		}
	}, [deleteTarget, activeSessionId, onNewChat]);

	const sorted = [...sessions].sort((a, b) => b.createdAt - a.createdAt);

	return (
		<>
			<Sidebar className="border-none">
				<SidebarHeader className="p-0">
					<Titlebar>
						<ToolbarButton onClick={() => setOpen(!open)}>
							<PanelLeftIcon className="h-4 w-4" />
						</ToolbarButton>
						<ToolbarButton>
							<Search className="h-4 w-4" />
						</ToolbarButton>
						<ToolbarButton onClick={onNewChat}>
							<PenLine className="h-4 w-4" />
						</ToolbarButton>
					</Titlebar>
				</SidebarHeader>

				<SidebarContent className="px-2">
					<SidebarGroup className="gap-3">
						<div className="px-2 pt-1 text-base font-serif italic tracking-tight text-sidebar-foreground/80">
							JAI
						</div>
						<SidebarGroupContent>
							<SidebarMenu>
								<SidebarMenuItem>
									<SidebarMenuButton
										className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground active:bg-sidebar-primary/85 active:text-sidebar-primary-foreground py-3! justify-center rounded-lg active:scale-[0.98] transition-all"
										onClick={onNewChat}
									>
										<PenLine className="w-4 h-4" />
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
									{sorted.map((s) => (
										<SidebarMenuItem key={s.sessionId}>
											<SidebarMenuButton
												className="p-3!"
												isActive={s.sessionId === activeSessionId}
												onClick={() => onSelectSession?.({ sessionId: s.sessionId })}
											>
												<span className="truncate">{s.sessionId.slice(0, 8)}...</span>
											</SidebarMenuButton>
											<SidebarMenuAction
												showOnHover
												className="text-sidebar-foreground/40 hover:text-destructive"
												onClick={(e) => {
													e.stopPropagation();
													setDeleteTarget(s);
												}}
											>
												<X className="w-3.5 h-3.5" />
											</SidebarMenuAction>
										</SidebarMenuItem>
									))}
								</SidebarMenu>
							</SidebarGroupContent>
						</SidebarGroup>
					) : (
						<SidebarGroup>
							<SidebarGroupContent>
								<div className="flex flex-col items-center gap-1.5 py-10 text-center">
									<Search className="w-5 h-5 text-sidebar-foreground/20" />
									<p className="text-xs text-sidebar-foreground/40">暂无对话记录</p>
								</div>
							</SidebarGroupContent>
						</SidebarGroup>
					)}
				</SidebarContent>

				<SidebarFooter className="border-t border-sidebar-foreground/6">
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton
								className="text-sidebar-foreground/50 hover:text-sidebar-foreground"
								onClick={() => windowClient.openSettings()}
							>
								<Settings2 className="w-4 h-4" />
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
