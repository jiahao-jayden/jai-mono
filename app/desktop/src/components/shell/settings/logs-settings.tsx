import { cn } from "cn";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type MessageDescriptor, useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { desktop } from "@/lib/desktop";
import { useIcons } from "@/lib/icon-context";
import { DESKTOP_LOG_TAIL_BYTES, type DesktopLogFile, type DesktopLogTail } from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";
import { TabItem, Tabs, TabsList } from "../../ui/tabs";

type LogSourceId = "app" | "agent" | "trace";

const logSources: readonly {
	readonly id: LogSourceId;
	readonly fileId: string;
	readonly label: MessageDescriptor;
	readonly description: MessageDescriptor;
}[] = [
	{
		id: "agent",
		fileId: "runtime-host/host.log",
		label: desktopMessages.settingsLogsSourceAgent,
		description: desktopMessages.settingsLogsSourceAgentDescription,
	},
	{
		id: "app",
		fileId: "desktop/main.log",
		label: desktopMessages.settingsLogsSourceApp,
		description: desktopMessages.settingsLogsSourceAppDescription,
	},
	{
		id: "trace",
		fileId: "runtime-host/telemetry.jsonl",
		label: desktopMessages.settingsLogsSourceTrace,
		description: desktopMessages.settingsLogsSourceTraceDescription,
	},
];

export function LogsSettings() {
	const intl = useIntl();
	const icons = useIcons();
	const limit = formatLogBytes(DESKTOP_LOG_TAIL_BYTES);
	const requestRef = useRef(0);
	const viewerRef = useRef<HTMLPreElement>(null);
	const [sourceId, setSourceId] = useState<LogSourceId>("agent");
	const [files, setFiles] = useState<readonly DesktopLogFile[]>([]);
	const [tail, setTail] = useState<DesktopLogTail | undefined>(undefined);
	const [loading, setLoading] = useState(true);
	const [failed, setFailed] = useState(false);
	const [confirmingClear, setConfirmingClear] = useState(false);
	const [deletedCount, setDeletedCount] = useState<number | undefined>(undefined);

	const source = logSources.find((candidate) => candidate.id === sourceId) ?? logSources[0];
	const file = files.find((candidate) => candidate.id === source.fileId);
	const rotated = files.filter((candidate) => !candidate.active);
	const rotatedBytes = rotated.reduce((total, candidate) => total + candidate.bytes, 0);

	const load = useCallback(async (fileId: string) => {
		const request = requestRef.current + 1;
		requestRef.current = request;
		setLoading(true);
		setFailed(false);
		setConfirmingClear(false);
		try {
			const listed = await desktop.logs.list();
			const exists = listed.some((candidate) => candidate.id === fileId);
			const next = exists ? await desktop.logs.read({ id: fileId }) : undefined;
			if (requestRef.current !== request) return;
			setFiles(listed);
			setTail(next);
		} catch {
			if (requestRef.current !== request) return;
			setFailed(true);
		} finally {
			if (requestRef.current === request) setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load(source.fileId);
	}, [load, source.fileId]);

	useLayoutEffect(() => {
		const viewer = viewerRef.current;
		if (viewer && tail) viewer.scrollTop = viewer.scrollHeight;
	}, [tail]);

	const run = async (action: () => Promise<void>) => {
		setFailed(false);
		try {
			await action();
		} catch {
			setFailed(true);
		}
	};

	const clear = () => {
		if (!file) return;
		if (!confirmingClear) {
			setConfirmingClear(true);
			return;
		}
		void run(async () => {
			await desktop.logs.clear({ id: file.id });
			await load(source.fileId);
		});
	};

	const deleteRotated = () =>
		run(async () => {
			const result = await desktop.logs.deleteRotated();
			await load(source.fileId);
			setDeletedCount(result.deleted);
		});

	const meta = file
		? intl.formatMessage(desktopMessages.settingsLogsMeta, {
				size: formatLogBytes(file.bytes),
				time: intl.formatDate(file.modifiedAt, {
					month: "short",
					day: "numeric",
					hour: "2-digit",
					minute: "2-digit",
				}),
			})
		: undefined;
	const clearLabel = intl.formatMessage(
		confirmingClear ? desktopMessages.settingsLogsClearConfirm : desktopMessages.settingsLogsClear,
	);
	const clearClassName = cn(confirmingClear && "text-destructive hover:text-destructive");
	const text = tail?.text ?? "";
	const showEmpty = !loading && !failed && text.length === 0;

	return (
		<div className="flex flex-col gap-6 px-8 py-6">
			<p className="max-w-xl text-[13px] leading-relaxed text-muted-foreground">
				{intl.formatMessage(desktopMessages.settingsLogsDescription, { limit })}
			</p>

			<section className="flex flex-col gap-3">
				<Tabs value={sourceId} onValueChange={(value) => setSourceId(value as LogSourceId)}>
					<TabsList aria-label={intl.formatMessage(desktopMessages.settingsLogs)}>
						{logSources.map((candidate) => (
							<TabItem key={candidate.id} value={candidate.id} label={intl.formatMessage(candidate.label)} />
						))}
					</TabsList>
				</Tabs>
				<p className="text-[13px] text-muted-foreground">{intl.formatMessage(source.description)}</p>

				<div className="flex flex-col overflow-hidden rounded-xl bg-surface-primary shadow-[0_0_0_.5px_var(--border-surface)]">
					<div className="flex items-center gap-2 px-3 py-2">
						<div className="min-w-0 flex-1">
							<p className="truncate font-mono text-[12px] text-foreground">{source.fileId}</p>
							{meta ? <p className="text-[11px] text-muted-foreground">{meta}</p> : null}
						</div>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							leadingIcon={icons["rotate-ccw"]}
							loading={loading}
							onClick={() => void load(source.fileId)}
						>
							{intl.formatMessage(desktopMessages.settingsLogsRefresh)}
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							leadingIcon={icons["folder-open"]}
							disabled={!file}
							onClick={() => file && void run(() => desktop.logs.reveal({ id: file.id }))}
						>
							{intl.formatMessage(desktopMessages.settingsLogsReveal)}
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							leadingIcon={icons.trash}
							disabled={!file || file.bytes === 0}
							onClick={clear}
							onBlur={() => setConfirmingClear(false)}
							className={clearClassName}
						>
							{clearLabel}
						</Button>
					</div>
					{tail?.truncated ? (
						<p className="px-3 pb-2 text-[11px] text-muted-foreground" role="status">
							{intl.formatMessage(desktopMessages.settingsLogsTruncated, {
								size: formatLogBytes(tail.bytes),
								limit,
							})}
						</p>
					) : null}
					{showEmpty ? (
						<p className="border-t-[.5px] border-[var(--border-surface)] px-3 py-10 text-center text-[13px] text-muted-foreground">
							{intl.formatMessage(desktopMessages.settingsLogsEmpty)}
						</p>
					) : (
						<pre
							ref={viewerRef}
							aria-busy={loading}
							className="h-80 overflow-auto border-t-[.5px] border-[var(--border-surface)] bg-background/60 px-3 py-2.5 font-mono text-[12px] leading-5 break-all whitespace-pre-wrap text-foreground"
						>
							{text}
						</pre>
					)}
				</div>
				{failed ? (
					<p className="text-[12px] text-destructive" role="alert">
						{intl.formatMessage(desktopMessages.settingsLogsActionFailed)}
					</p>
				) : null}
			</section>

			<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-muted-foreground">
				<span className="mr-auto" role="status">
					{deletedCount !== undefined
						? intl.formatMessage(desktopMessages.settingsLogsDeletedRotated, { count: deletedCount })
						: intl.formatMessage(desktopMessages.settingsLogsRotated, {
								count: rotated.length,
								size: formatLogBytes(rotatedBytes),
							})}
				</span>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={rotated.length === 0}
					onClick={() => void deleteRotated()}
				>
					{intl.formatMessage(desktopMessages.settingsLogsDeleteRotated)}
				</Button>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={() => void run(() => desktop.logs.openDirectory())}
				>
					{intl.formatMessage(desktopMessages.settingsLogsOpenFolder)}
				</Button>
			</div>
		</div>
	);
}

function formatLogBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const kilobytes = bytes / 1024;
	if (kilobytes < 1024) return `${kilobytes >= 10 ? Math.round(kilobytes) : Number(kilobytes.toFixed(1))} KB`;
	return `${(kilobytes / 1024).toFixed(1)} MB`;
}
