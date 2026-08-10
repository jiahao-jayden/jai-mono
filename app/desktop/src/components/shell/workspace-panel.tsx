import { useEffect, useState } from "react";
import { MarkdownContent } from "@/components/ui/chat-message";
import { Button } from "@/components/ui/button";
import { desktop } from "@/lib/desktop";
import { useIcons } from "@/lib/icon-context";
import type { DesktopArtifact, DesktopArtifactPreview } from "../../../shared/desktop-rpc";

interface ArtifactPanelProps {
	readonly sessionId: string;
	readonly artifacts: readonly DesktopArtifact[];
	readonly selectedArtifactId: string | null;
	onSelectArtifact(artifact: DesktopArtifact): void;
}

export function ArtifactPanel({ sessionId, artifacts, selectedArtifactId, onSelectArtifact }: ArtifactPanelProps) {
	const icons = useIcons();
	const ArchiveIcon = icons.archive;
	const FileCodeIcon = icons["file-code"];
	const HtmlIcon = icons["rectangle-horizontal"];
	const LoadingIcon = icons.loader;
	const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? null;
	const [preview, setPreview] = useState<DesktopArtifactPreview | null>(null);
	const [previewState, setPreviewState] = useState<"idle" | "loading" | "error">("idle");

	useEffect(() => {
		let cancelled = false;
		if (!selectedArtifact) {
			setPreview(null);
			setPreviewState("idle");
			return;
		}

		setPreview(null);
		setPreviewState("loading");
		void desktop.artifact
			.read({ sessionId, artifactId: selectedArtifact.id })
			.then((result) => {
				if (cancelled) return;
				setPreview(result);
				setPreviewState("idle");
			})
			.catch(() => {
				if (cancelled) return;
				setPreviewState("error");
			});

		return () => {
			cancelled = true;
		};
	}, [selectedArtifact, sessionId]);

	return (
		<aside
			id="artifact-panel"
			aria-label="Artifact preview"
			className="h-full w-full min-w-0 overflow-y-auto bg-background py-3 pr-3"
		>
			<div className="flex min-h-full flex-col overflow-hidden rounded-[14px] border border-border bg-card">
				<div className="flex h-13 shrink-0 items-center gap-2 border-b border-border/45 px-4">
					<ArchiveIcon size={16} className="text-muted-foreground" />
					<h2 className="min-w-0 flex-1 text-[14px] font-semibold">Artifacts</h2>
					<span className="text-[12px] tabular-nums text-muted-foreground">{artifacts.length}</span>
				</div>

				{artifacts.length === 0 ? (
					<ArtifactEmptyState icon={ArchiveIcon} />
				) : (
					<div className="flex min-h-0 flex-1 flex-col">
						<div className="max-h-56 shrink-0 overflow-y-auto border-b border-border/45 p-2">
							<ul className="space-y-1" aria-label="Session artifacts">
								{artifacts.map((artifact) => {
									const isSelected = artifact.id === selectedArtifact?.id;
									const ArtifactIcon = artifact.format === "html" ? HtmlIcon : FileCodeIcon;
									return (
										<li key={artifact.id}>
											<Button
												type="button"
												variant="ghost"
												size="md"
												active={isSelected}
												onClick={() => onSelectArtifact(artifact)}
												aria-current={isSelected ? "true" : undefined}
												className="h-auto w-full justify-start rounded-[8px] px-2 py-1.5"
												contentClassName="w-full min-w-0 justify-start"
												labelClassName="flex min-w-0 flex-1 items-center gap-2"
											>
												<ArtifactIcon size={15} className="shrink-0 text-muted-foreground" />
												<span className="min-w-0 flex-1 text-left">
													<span
														className="block truncate text-[12.5px] font-medium text-foreground"
														title={artifact.path}
													>
														{artifactName(artifact.path)}
													</span>
													<span
														className="mt-0.5 block truncate text-[11px] text-muted-foreground"
														title={artifact.path}
													>
														{artifact.path}
													</span>
												</span>
												<span className="shrink-0 text-[10.5px] font-medium uppercase text-muted-foreground">
													{artifact.format}
												</span>
											</Button>
										</li>
									);
								})}
							</ul>
						</div>
						<ArtifactPreview
							artifact={selectedArtifact}
							preview={preview}
							previewState={previewState}
							loadingIcon={LoadingIcon}
							fileIcon={FileCodeIcon}
						/>
					</div>
				)}
			</div>
		</aside>
	);
}

function ArtifactEmptyState({ icon: ArchiveIcon }: { readonly icon: ReturnType<typeof useIcons>["archive"] }) {
	return (
		<div className="flex min-h-90 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
			<span aria-hidden="true" className="flex size-10 items-center justify-center text-muted-foreground">
				<ArchiveIcon size={22} />
			</span>
			<h3 className="mt-3 text-[13px] font-semibold">No artifacts yet</h3>
			<p className="mt-2 max-w-56 text-[12px] leading-5 text-foreground/65">
				生成的 Markdown 和 HTML 会显示在这里。
			</p>
		</div>
	);
}

function ArtifactPreview({
	artifact,
	preview,
	previewState,
	loadingIcon: LoadingIcon,
	fileIcon: FileCodeIcon,
}: {
	readonly artifact: DesktopArtifact | null;
	readonly preview: DesktopArtifactPreview | null;
	readonly previewState: "idle" | "loading" | "error";
	readonly loadingIcon: ReturnType<typeof useIcons>["loader"];
	readonly fileIcon: ReturnType<typeof useIcons>["file-code"];
}) {
	if (!artifact) {
		return (
			<div className="flex min-h-72 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
				<FileCodeIcon size={22} className="text-muted-foreground" />
				<h3 className="mt-3 text-[13px] font-semibold">Select an artifact</h3>
				<p className="mt-2 max-w-56 text-[12px] leading-5 text-foreground/65">选择一个文件以查看预览。</p>
			</div>
		);
	}

	if (previewState === "loading" || (previewState === "idle" && !preview)) {
		return (
			<div className="flex min-h-72 flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center text-[12px] text-foreground/65">
				<LoadingIcon size={18} className="animate-spin text-muted-foreground" />
				Loading preview
			</div>
		);
	}

	if (previewState === "error" || !preview) {
		return (
			<div className="flex min-h-72 flex-1 flex-col items-center justify-center px-6 py-10 text-center">
				<FileCodeIcon size={22} className="text-muted-foreground" />
				<h3 className="mt-3 text-[13px] font-semibold">Preview unavailable</h3>
				<p className="mt-2 max-w-56 text-[12px] leading-5 text-foreground/65">
					文件不再可用，或当前项目没有访问权限。
				</p>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/45 px-3 text-[12px] text-foreground/65">
				<FileCodeIcon size={14} className="shrink-0" />
				<span className="min-w-0 flex-1 truncate" title={artifact.path}>
					{artifact.path}
				</span>
			</div>
			{artifact.format === "markdown" ? (
				<div className="min-h-72 flex-1 overflow-y-auto px-4 py-4">
					<MarkdownContent content={preview.content} className="text-[13px] leading-6" />
				</div>
			) : (
				<iframe
					title={artifactName(artifact.path)}
					sandbox=""
					referrerPolicy="no-referrer"
					srcDoc={sandboxHtml(preview.content)}
					className="min-h-72 flex-1 border-0 bg-white"
				/>
			)}
		</div>
	);
}

function artifactName(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function sandboxHtml(content: string): string {
	const policy = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:";
	const csp = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
	const headStart = content.match(/<head\b[^>]*>/i);
	if (headStart?.index !== undefined) {
		const insertionIndex = headStart.index + headStart[0].length;
		return `${content.slice(0, insertionIndex)}${csp}${content.slice(insertionIndex)}`;
	}
	const htmlStart = content.match(/<html\b[^>]*>/i);
	if (htmlStart?.index !== undefined) {
		const insertionIndex = htmlStart.index + htmlStart[0].length;
		return `${content.slice(0, insertionIndex)}<head>${csp}</head>${content.slice(insertionIndex)}`;
	}
	return `<!doctype html><html><head>${csp}</head><body>${content}</body></html>`;
}
