import { Delete03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { MoreHorizontalIcon, PanelLeftIcon, PenLine, Search, Settings2, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";
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
import { useSessions } from "@/hooks/use-sessions";
import { windowClient } from "@/lib/ipc-client";
import { useChatStore } from "@/stores/chat";
import type { SessionInfo } from "@/types/chat";
import { Titlebar, ToolbarButton } from "./titlebar";

export function AppSidebar() {
	const { open, setOpen } = useSidebar();
	const { sessions, deleteSession } = useSessions();
	const { sessionId: activeSessionId, newChat, loadSession } = useChatStore();
	const [deleteTarget, setDeleteTarget] = useState<SessionInfo | null>(null);

	const confirmDelete = useCallback(async () => {
		if (!deleteTarget) return;
		await deleteSession(deleteTarget.sessionId);
		if (activeSessionId === deleteTarget.sessionId) {
			newChat();
		}
		setDeleteTarget(null);
	}, [deleteTarget, activeSessionId, newChat, deleteSession]);

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
						<ToolbarButton onClick={newChat}>
							<PenLine className="h-4 w-4" />
						</ToolbarButton>
					</Titlebar>
				</SidebarHeader>

				<SidebarContent className="px-1">
					<SidebarGroup className="gap-3">
						<div className="px-2 pt-1 text-base font-serif italic tracking-tight text-sidebar-foreground/80">
							JAI
						</div>
						<SidebarGroupContent>
							<SidebarMenu>
								<SidebarMenuItem>
									<SidebarMenuButton
										className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90 hover:text-sidebar-primary-foreground active:bg-sidebar-primary/85 active:text-sidebar-primary-foreground py-3! justify-center rounded-lg active:scale-[0.98] transition-all"
										onClick={newChat}
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
												className="rounded-md! px-4! group-hover/menu-item:bg-sidebar-accent group-hover/menu-item:text-sidebar-accent-foreground cursor-pointer"
												isActive={s.sessionId === activeSessionId}
												onClick={() => loadSession({ sessionId: s.sessionId })}
											>
												<span className="truncate">{s.sessionId.slice(0, 8)}...</span>
											</SidebarMenuButton>
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<SidebarMenuAction showOnHover className="cursor-pointer">
														<MoreHorizontalIcon className="w-4 h-4 text-sidebar-foreground/30 hover:text-sidebar-foreground" />
													</SidebarMenuAction>
												</DropdownMenuTrigger>
												<DropdownMenuContent side="bottom" align="center">
													<DropdownMenuItem
														variant="destructive"
														onClick={() => setDeleteTarget(s)}
														className="text-destructive! focus:bg-destructive/10! focus:text-destructive!"
													>
														<HugeiconsIcon icon={Delete03Icon} className="w-4 h-4 text-destructive" />
														删除
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
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
							<SidebarMenuButton onClick={() => windowClient.openSettings()}>
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
