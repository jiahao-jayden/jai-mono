import type { FileContent } from "@jayden/jai-gateway";
import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";

interface FileViewerProps {
	workspaceId: string;
	filePath: string;
	onClose: () => void;
}

function isImageMime(mime: string): boolean {
	return mime.startsWith("image/");
}

function isVideoMime(mime: string): boolean {
	return mime.startsWith("video/");
}

function isTextMime(mime: string): boolean {
	return (
		mime.startsWith("text/") || mime === "application/json" || mime === "application/xml" || mime === "image/svg+xml"
	);
}

function getLanguage(filename: string): string {
	const ext = filename.split(".").pop()?.toLowerCase() ?? "";
	const map: Record<string, string> = {
		ts: "typescript",
		tsx: "tsx",
		js: "javascript",
		jsx: "jsx",
		mjs: "javascript",
		cjs: "javascript",
		py: "python",
		rs: "rust",
		go: "go",
		java: "java",
		c: "c",
		cpp: "cpp",
		h: "c",
		cs: "csharp",
		rb: "ruby",
		php: "php",
		swift: "swift",
		kt: "kotlin",
		json: "json",
		jsonl: "json",
		yaml: "yaml",
		yml: "yaml",
		toml: "toml",
		md: "markdown",
		html: "html",
		css: "css",
		scss: "scss",
		sh: "bash",
		bash: "bash",
		zsh: "bash",
		sql: "sql",
		xml: "xml",
		graphql: "graphql",
		txt: "text",
		log: "text",
		env: "text",
		svg: "xml",
	};
	return map[ext] ?? "text";
}

function shortPath(fullPath: string): string {
	const parts = fullPath.split("/");
	if (parts.length <= 3) return fullPath;
	return `.../${parts.slice(-3).join("/")}`;
}

const MIME_MAP: Record<string, string> = {
	ts: "text/typescript",
	tsx: "text/typescript",
	js: "text/javascript",
	jsx: "text/javascript",
	mjs: "text/javascript",
	cjs: "text/javascript",
	json: "application/json",
	jsonl: "application/json",
	md: "text/markdown",
	yaml: "text/yaml",
	yml: "text/yaml",
	toml: "text/toml",
	xml: "application/xml",
	html: "text/html",
	htm: "text/html",
	css: "text/css",
	scss: "text/scss",
	less: "text/less",
	py: "text/x-python",
	rs: "text/x-rust",
	go: "text/x-go",
	java: "text/x-java",
	kt: "text/x-kotlin",
	c: "text/x-c",
	cpp: "text/x-c++",
	h: "text/x-c",
	cs: "text/x-csharp",
	rb: "text/x-ruby",
	php: "text/x-php",
	swift: "text/x-swift",
	sh: "text/x-shellscript",
	bash: "text/x-shellscript",
	zsh: "text/x-shellscript",
	sql: "text/x-sql",
	graphql: "text/x-graphql",
	txt: "text/plain",
	log: "text/plain",
	env: "text/plain",
	csv: "text/csv",
	gitignore: "text/plain",
	dockerignore: "text/plain",
	editorconfig: "text/plain",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	ico: "image/x-icon",
	bmp: "image/bmp",
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
	pdf: "application/pdf",
};

function guessMime(filePath: string): string {
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
	return MIME_MAP[ext] ?? "application/octet-stream";
}

function TextFileViewer({ workspaceId, filePath }: { workspaceId: string; filePath: string }) {
	const [data, setData] = useState<FileContent | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		setError(null);
		setData(null);

		gateway.workspace
			.readFile(workspaceId, filePath)
			.then((res) => {
				if (!cancelled) setData(res);
			})
			.catch((err) => {
				if (!cancelled) setError(String(err));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [workspaceId, filePath]);

	if (loading) {
		return <div className="p-4 text-sm text-muted-foreground/50">Loading...</div>;
	}
	if (error) {
		return <div className="p-4 text-sm text-destructive/70">{error}</div>;
	}
	if (!data) return null;

	const lang = getLanguage(filePath);
	const codeBlock = `\`\`\`${lang}\n${data.content}\n\`\`\``;

	return (
		<div className="overflow-auto text-[13px] leading-relaxed [&_pre]:rounded-none! [&_pre]:border-0! [&_pre]:bg-transparent!">
			<MessageResponse>{codeBlock}</MessageResponse>
		</div>
	);
}

function ImageViewer({ workspaceId, filePath }: { workspaceId: string; filePath: string }) {
	const url = gateway.workspace.rawUrl(workspaceId, filePath);
	return (
		<div className="flex items-center justify-center p-4 overflow-auto">
			<img src={url} alt={filePath} className="max-w-full max-h-[70vh] object-contain rounded-lg" />
		</div>
	);
}

function VideoViewer({ workspaceId, filePath }: { workspaceId: string; filePath: string }) {
	const url = gateway.workspace.rawUrl(workspaceId, filePath);
	return (
		<div className="flex items-center justify-center p-4">
			<video src={url} controls className="max-w-full max-h-[70vh] rounded-lg">
				<track kind="captions" />
			</video>
		</div>
	);
}

function BinaryViewer({ filePath }: { filePath: string }) {
	const ext = filePath.split(".").pop()?.toUpperCase() ?? "FILE";
	return (
		<div className="flex flex-col items-center justify-center gap-2 p-8 text-muted-foreground/50">
			<span className="rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wider bg-muted">{ext}</span>
			<p className="text-sm">Binary file — preview not available</p>
		</div>
	);
}

export function FileViewer({ workspaceId, filePath, onClose }: FileViewerProps) {
	const mime = guessMime(filePath);
	const isText = isTextMime(mime);
	const isImage = isImageMime(mime);
	const isVideo = isVideoMime(mime);

	return (
		<div className="flex flex-col h-full min-h-0">
			<div className="flex items-center justify-between px-3 py-2 border-b border-border/50 shrink-0">
				<span className="text-[12px] text-muted-foreground truncate" title={filePath}>
					{shortPath(filePath)}
				</span>
				<button
					type="button"
					onClick={onClose}
					className="p-0.5 rounded-sm hover:bg-muted transition-colors text-muted-foreground/50 hover:text-foreground"
				>
					<XIcon className="size-3.5" />
				</button>
			</div>

			<div className={cn("flex-1 min-h-0 overflow-auto", isText && "is-assistant")}>
				{isText && <TextFileViewer workspaceId={workspaceId} filePath={filePath} />}
				{isImage && <ImageViewer workspaceId={workspaceId} filePath={filePath} />}
				{isVideo && <VideoViewer workspaceId={workspaceId} filePath={filePath} />}
				{!isText && !isImage && !isVideo && <BinaryViewer filePath={filePath} />}
			</div>
		</div>
	);
}
