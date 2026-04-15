import { FolderOpenIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppToolbar } from "@/components/shell/app-toolbar";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";
import { useChatStore } from "@/stores/chat";
import { useFilePanelStore } from "@/stores/file-panel";
import { useSessionStore } from "@/stores/session";

const drag = { WebkitAppRegion: "drag" } as React.CSSProperties;

function EditableTitle() {
	const title = useSessionStore((s) => s.title);
	const sessionId = useChatStore((s) => s.sessionId);
	const { setTitle, updateSessionTitle } = useSessionStore();

	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (editing) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [editing]);

	const startEditing = useCallback(() => {
		if (!title) return;
		setDraft(title);
		setEditing(true);
	}, [title]);

	const commit = useCallback(() => {
		setEditing(false);
		const trimmed = draft.trim();
		if (!trimmed || trimmed === title || !sessionId) return;

		setTitle(trimmed);
		updateSessionTitle(sessionId, trimmed);
		gateway.sessions.update(sessionId, { title: trimmed }).catch((err) => {
			console.error("[gateway] update title failed:", err);
		});
	}, [draft, title, sessionId, setTitle, updateSessionTitle]);

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

	if (!title) return null;

	if (editing) {
		return (
			<input
				ref={inputRef}
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={handleKeyDown}
				maxLength={30}
				className={cn(
					"text-sm font-semibold tracking-tight leading-none font-serif",
					"bg-transparent outline-none w-[15ch]",
					"border-b border-foreground/20 focus:border-foreground/50",
					"py-0.5 transition-colors duration-150",
				)}
			/>
		);
	}

	return (
		<button
			type="button"
			onClick={startEditing}
			className={cn(
				"text-sm font-semibold text-foreground tracking-tight leading-none font-serif",
				"truncate text-left w-fit",
				"rounded-sm px-1 -mx-1 py-0.5",
				"transition-all duration-150 ease-out",
				"hover:bg-foreground/4 hover:text-foreground hover:cursor-pointer",
				"active:scale-[0.98]",
				"cursor-text",
			)}
		>
			{title.length > 15 ? `${title.slice(0, 15)}…` : title}
		</button>
	);
}

export function ChatHeader() {
	const { open, toggleSidebar } = useSidebar();
	const newChat = useChatStore((s) => s.newChat);
	const sessionId = useChatStore((s) => s.sessionId);
	const title = useSessionStore((s) => s.title);
	const toggleFilePanel = useFilePanelStore((s) => s.toggle);
	const filePanelOpen = useFilePanelStore((s) => s.open);
	const mobileTitle = title?.trim() ? (title.length > 18 ? `${title.slice(0, 18)}…` : title) : "Untitled";

	return (
		<>
			{/* Desktop drag region + titlebar buttons */}
			<div className={cn("w-full shrink-0 hidden md:flex items-center", open ? "h-3" : "h-12")}>
				{!open && (
					<AppToolbar mode="desktop" sidebarIcon="right" onToggleSidebar={toggleSidebar} onNewChat={newChat} />
				)}
				<div className="h-full flex-1" style={drag} />
			</div>

			{/* Session info header */}
			<div className="hidden shrink-0 items-center justify-between px-5 md:flex">
				<div className="flex flex-col gap-0.5 min-w-0 flex-1 mr-3">
					<EditableTitle />
				</div>
				{sessionId && (
					<button
						type="button"
						onClick={toggleFilePanel}
						className={cn(
							"p-1.5 rounded-md transition-colors",
							filePanelOpen
								? "bg-foreground/8 text-foreground"
								: "text-muted-foreground/50 hover:text-foreground hover:bg-foreground/4",
						)}
						title="Toggle file panel"
					>
						<FolderOpenIcon className="size-4" />
					</button>
				)}
			</div>

			{/* Mobile header */}
			<AppToolbar mode="mobile" title={mobileTitle} onToggleSidebar={toggleSidebar} onNewChat={newChat} />
		</>
	);
}
