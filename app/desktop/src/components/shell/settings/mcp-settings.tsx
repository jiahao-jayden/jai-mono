import { useCallback, useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcon } from "@/lib/icon-context";
import { cn } from "cn";
import type {
	DesktopMcpServerStatus,
	DesktopMcpSettingsInput,
	DesktopMcpSettingsSnapshot,
	DesktopMcpStatus,
} from "../../../../shared/desktop-rpc";
import { Button } from "../../ui/button";

interface McpSettingsProps {
	readonly snapshot?: DesktopMcpSettingsSnapshot;
	readonly loading: boolean;
	readonly loadError: boolean;
	readonly onRetry: () => void;
	readonly onSave: (input: DesktopMcpSettingsInput) => Promise<DesktopMcpSettingsSnapshot>;
	readonly onRefreshStatus: () => Promise<DesktopMcpStatus>;
}

export function McpSettings({
	snapshot,
	loading,
	loadError,
	onRetry,
	onSave,
	onRefreshStatus,
}: McpSettingsProps) {
	const intl = useIntl();
	const PlugIcon = useIcon("plug");
	const RefreshIcon = useIcon("rotate-ccw");
	const [draft, setDraft] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const [status, setStatus] = useState<DesktopMcpStatus>();
	const [statusLoading, setStatusLoading] = useState(false);

	const initialJson = useMemo(() => stringifyMcp(snapshot?.mcp), [snapshot]);

	useEffect(() => {
		setDraft(initialJson);
		setError(undefined);
	}, [initialJson]);

	const refreshStatus = useCallback(async () => {
		setStatusLoading(true);
		try {
			const result = await onRefreshStatus();
			setStatus(result);
		} catch {
			setStatus(undefined);
		} finally {
			setStatusLoading(false);
		}
	}, [onRefreshStatus]);

	useEffect(() => {
		if (!snapshot) return;
		void refreshStatus();
	}, [snapshot, refreshStatus]);

	const save = async () => {
		if (!snapshot) return;
		const parsed = tryParseJson(draft);
		if (parsed === undefined) {
			setError(intl.formatMessage(desktopMessages.settingsMcpInvalidJson));
			return;
		}
		setSaving(true);
		setError(undefined);
		try {
			await onSave({ revision: snapshot.revision, mcp: parsed });
			setError(undefined);
		} catch (_cause) {
			setError(intl.formatMessage(desktopMessages.settingsMcpSaveError));
		} finally {
			setSaving(false);
		}
	};

	if (!snapshot) {
		return (
			<div className="flex min-h-0 flex-1 items-center justify-center px-8 py-10 text-center">
				<div className="max-w-80">
					<PlugIcon className="mx-auto mb-3 size-5 text-muted-foreground" />
					<p className="text-[14px] font-semibold">
						{intl.formatMessage(loading ? desktopMessages.settingsLoading : desktopMessages.settingsUnavailable)}
					</p>
					{loadError ? (
						<Button type="button" variant="tertiary" className="mt-4" onClick={onRetry}>
							{intl.formatMessage(desktopMessages.settingsRetry)}
						</Button>
					) : null}
				</div>
			</div>
		);
	}

	const textareaClassName = cn(
		"w-full min-w-0 resize-y border border-input bg-input/20 font-mono text-[12.5px] leading-relaxed text-foreground transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
		"min-h-72 px-3 py-2.5",
	);

	return (
		<div className="flex min-h-0 flex-col gap-5 px-8 py-6">
			<div className="max-w-105">
				<h2 className="text-[14px] font-medium">{intl.formatMessage(desktopMessages.settingsMcp)}</h2>
				<p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
					{intl.formatMessage(desktopMessages.settingsMcpDescription)}
				</p>
			</div>

			<div className="flex flex-col gap-2">
				<label className="text-[13.5px] font-medium" htmlFor="mcp-config">
					{intl.formatMessage(desktopMessages.settingsMcpConfigLabel)}
				</label>
				<textarea
					id="mcp-config"
					className={textareaClassName}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					placeholder={intl.formatMessage(desktopMessages.settingsMcpConfigPlaceholder)}
					spellCheck={false}
					autoComplete="off"
					aria-label={intl.formatMessage(desktopMessages.settingsMcpConfigLabel)}
				/>
			</div>

			<div className="flex flex-wrap items-center gap-x-4 gap-y-3">
				<Button type="button" loading={saving} disabled={saving} onClick={() => void save()}>
					{intl.formatMessage(desktopMessages.settingsMcpSave)}
				</Button>
				<Button
					type="button"
					variant="tertiary"
					leadingIcon={RefreshIcon}
					loading={statusLoading}
					disabled={statusLoading}
					onClick={() => void refreshStatus()}
				>
					{intl.formatMessage(desktopMessages.settingsMcpRefresh)}
				</Button>
			</div>

			{error ? (
				<p className="max-w-125 text-[12px] leading-relaxed text-destructive" role="alert">
					{error}
				</p>
			) : null}

			<McpStatusTable status={status} loading={statusLoading} />
		</div>
	);
}

function McpStatusTable({
	status,
	loading,
}: {
	readonly status?: DesktopMcpStatus;
	readonly loading: boolean;
}) {
	const intl = useIntl();
	const servers = status?.servers ?? [];

	if (loading && !status) {
		return (
			<p className="text-[13px] text-muted-foreground" role="status">
				{intl.formatMessage(desktopMessages.settingsMcpRefreshing)}
			</p>
		);
	}

	if (servers.length === 0) {
		return (
			<p className="text-[13px] text-muted-foreground" role="status">
				{intl.formatMessage(desktopMessages.settingsMcpStatusEmpty)}
			</p>
		);
	}

	return (
		<div className="overflow-hidden rounded-lg border border-border">
			<table className="w-full text-[13px]">
				<thead>
					<tr className="border-b border-border bg-muted-hover text-left text-[12px] text-muted-foreground">
						<th className="px-3 py-2 font-medium">
							{intl.formatMessage(desktopMessages.settingsMcpStatusColumnServer)}
						</th>
						<th className="px-3 py-2 font-medium">
							{intl.formatMessage(desktopMessages.settingsMcpStatusColumnType)}
						</th>
						<th className="px-3 py-2 font-medium">
							{intl.formatMessage(desktopMessages.settingsMcpStatusColumnStatus)}
						</th>
						<th className="px-3 py-2 font-medium">
							{intl.formatMessage(desktopMessages.settingsMcpStatusColumnTools)}
						</th>
					</tr>
				</thead>
				<tbody>
					{servers.map((server) => (
						<McpStatusRow key={server.name} server={server} />
					))}
				</tbody>
			</table>
		</div>
	);
}

function McpStatusRow({ server }: { readonly server: DesktopMcpServerStatus }) {
	const intl = useIntl();
	const statusText = server.connected
		? intl.formatMessage(desktopMessages.settingsMcpStatusConnected)
		: intl.formatMessage(desktopMessages.settingsMcpStatusDisconnected);
	const statusClassName = cn(
		"inline-flex items-center gap-1.5",
		server.connected ? "text-foreground" : "text-destructive",
	);
	const dotClassName = cn("size-1.5 rounded-full", server.connected ? "bg-emerald-500" : "bg-destructive");

	return (
		<tr className="border-b border-border last:border-b-0">
			<td className="px-3 py-2 font-medium">{server.name}</td>
			<td className="px-3 py-2 text-muted-foreground">{server.type}</td>
			<td className="px-3 py-2">
				<span className={statusClassName}>
					<span className={dotClassName} aria-hidden="true" />
					{statusText}
				</span>
				{server.error ? (
					<p className="mt-0.5 text-[12px] text-muted-foreground">{server.error}</p>
				) : null}
			</td>
			<td className="px-3 py-2 text-muted-foreground">
				{server.connected ? server.toolCount : "—"}
			</td>
		</tr>
	);
}

function stringifyMcp(mcp: unknown): string {
	if (mcp === undefined || mcp === null) return "";
	try {
		return JSON.stringify(mcp, null, 2);
	} catch {
		return "";
	}
}

function tryParseJson(value: string): unknown {
	if (value.trim() === "") return {};
	try {
		return JSON.parse(value);
	} catch {
		return undefined;
	}
}
