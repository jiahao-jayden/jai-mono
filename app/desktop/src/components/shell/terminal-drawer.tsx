import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { cn } from "cn";
import { useEffect, useMemo, useRef } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { desktop } from "@/lib/desktop";
import { useResolvedTheme } from "@/stores/theme";
import type { DesktopTerminalSnapshot } from "../../../shared/desktop-rpc";

export function TerminalDrawer({
	snapshot,
	visible,
}: {
	readonly snapshot: DesktopTerminalSnapshot;
	readonly visible: boolean;
}) {
	const intl = useIntl();

	return (
		<section
			className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background"
			aria-label={intl.formatMessage(desktopMessages.terminalTitle)}
		>
			<div className="relative min-h-0 flex-1 bg-background">
				<TerminalViewport snapshot={snapshot} visible={visible} />
			</div>
		</section>
	);
}

function TerminalViewport({
	snapshot,
	visible,
}: {
	readonly snapshot: DesktopTerminalSnapshot;
	readonly visible: boolean;
}) {
	const mountRef = useRef<HTMLDivElement>(null);
	const visibleRef = useRef(visible);
	const initialHistoryRef = useRef(snapshot.history);
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const theme = useResolvedTheme();
	const terminalTheme = useMemo(
		() =>
			theme === "dark"
				? { background: "#171717", foreground: "#f5f5f5", cursor: "#f5f5f5", selectionBackground: "#404040" }
				: { background: "#ffffff", foreground: "#262626", cursor: "#262626", selectionBackground: "#d4d4d4" },
		[theme],
	);
	const initialTerminalThemeRef = useRef(terminalTheme);

	useEffect(() => {
		if (terminalRef.current) terminalRef.current.options.theme = terminalTheme;
	}, [terminalTheme]);
	useEffect(() => {
		visibleRef.current = visible;
	}, [visible]);

	useEffect(() => {
		const mount = mountRef.current;
		if (!mount) return;
		const terminal = new Terminal({
			allowProposedApi: false,
			convertEol: false,
			cursorBlink: true,
			fontFamily: '"SF Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace',
			fontSize: 12,
			lineHeight: 1.25,
			scrollback: 5_000,
		});
		const fitAddon = new FitAddon();
		terminalRef.current = terminal;
		fitAddonRef.current = fitAddon;
		terminal.options.theme = initialTerminalThemeRef.current;
		terminal.loadAddon(fitAddon);
		terminal.open(mount);
		terminal.write(initialHistoryRef.current);
		const input = terminal.onData((data) => {
			void desktop.terminal.write({ sessionId: snapshot.sessionId, terminalId: snapshot.terminalId, data });
		});
		const removeListener = window.desktopRpc.onTerminalEvent((event) => {
			const terminalId = event.type === "restarted" ? event.snapshot.terminalId : event.terminalId;
			if (terminalId !== snapshot.terminalId) return;
			if (event.type === "output") {
				terminal.write(event.data, () => {
					void desktop.terminal.ack({
						sessionId: snapshot.sessionId,
						terminalId: snapshot.terminalId,
						bytes: event.bytes,
					});
				});
			}
			if (event.type === "cleared" || event.type === "restarted") terminal.reset();
		});
		const observer = new ResizeObserver(() => {
			if (!visibleRef.current) return;
			fitAddon.fit();
			const cols = Math.max(20, terminal.cols);
			const rows = Math.max(5, terminal.rows);
			void desktop.terminal.resize({
				sessionId: snapshot.sessionId,
				terminalId: snapshot.terminalId,
				cols,
				rows,
			});
		});
		observer.observe(mount);
		return () => {
			terminalRef.current = null;
			fitAddonRef.current = null;
			observer.disconnect();
			removeListener();
			input.dispose();
			terminal.dispose();
		};
	}, [snapshot.sessionId, snapshot.terminalId]);

	useEffect(() => {
		if (!visible) return;
		fitAddonRef.current?.fit();
		terminalRef.current?.focus();
	}, [visible]);

	return (
		<div
			ref={mountRef}
			className={cn("absolute inset-0 px-2 py-1", visible ? "z-10" : "pointer-events-none invisible")}
		/>
	);
}
