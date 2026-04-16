import type { FileContent } from "@jayden/jai-gateway";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { gateway } from "@/services/gateway";

interface FileViewerProps {
	workspaceId: string;
	filePath: string;
}

function isImageMime(mime: string): boolean {
	return mime.startsWith("image/");
}

function isVideoMime(mime: string): boolean {
	return mime.startsWith("video/");
}

function isTextMime(mime: string): boolean {
	return (
		mime.startsWith("text/") ||
		mime === "application/json" ||
		mime === "application/xml" ||
		mime === "image/svg+xml"
	);
}

const LANG_MAP: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	js: "javascript",
	jsx: "javascript",
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
	toml: "ini",
	md: "markdown",
	mdx: "markdown",
	html: "html",
	htm: "html",
	css: "css",
	scss: "scss",
	less: "less",
	sh: "shell",
	bash: "shell",
	zsh: "shell",
	sql: "sql",
	xml: "xml",
	svg: "xml",
	graphql: "graphql",
	txt: "plaintext",
	log: "plaintext",
	env: "ini",
	dockerfile: "dockerfile",
	makefile: "makefile",
};

function getMonacoLang(filePath: string): string {
	const name = filePath.split("/").pop()?.toLowerCase() ?? "";
	if (name === "dockerfile") return "dockerfile";
	if (name === "makefile") return "makefile";
	const ext = name.split(".").pop() ?? "";
	return LANG_MAP[ext] ?? "plaintext";
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
	mdx: "text/markdown",
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

function useIsDark() {
	const [dark, setDark] = useState(() =>
		document.documentElement.classList.contains("dark"),
	);

	useEffect(() => {
		const observer = new MutationObserver(() => {
			setDark(document.documentElement.classList.contains("dark"));
		});
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});
		return () => observer.disconnect();
	}, []);

	return dark;
}

function MonacoViewer({
	workspaceId,
	filePath,
}: { workspaceId: string; filePath: string }) {
	const [data, setData] = useState<FileContent | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const isDark = useIsDark();
	const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

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

	const handleMount: OnMount = useCallback((editor) => {
		editorRef.current = editor;
	}, []);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full text-sm text-muted-foreground/50">
				Loading...
			</div>
		);
	}
	if (error) {
		return (
			<div className="p-4 text-sm text-destructive/70">{error}</div>
		);
	}
	if (!data) return null;

	const lang = getMonacoLang(filePath);

	return (
		<Editor
			height="100%"
			language={lang}
			value={data.content}
			theme={isDark ? "vs-dark" : "vs"}
			onMount={handleMount}
			options={{
				readOnly: true,
				domReadOnly: true,
				minimap: { enabled: false },
				scrollBeyondLastLine: false,
				fontSize: 13,
				lineHeight: 20,
				lineNumbers: "on",
				renderLineHighlight: "none",
				overviewRulerBorder: false,
				overviewRulerLanes: 0,
				hideCursorInOverviewRuler: true,
				scrollbar: {
					verticalScrollbarSize: 4,
					horizontalScrollbarSize: 4,
					verticalSliderSize: 4,
				},
				padding: { top: 8 },
				wordWrap: "on",
				contextmenu: false,
				folding: true,
				glyphMargin: false,
				lineDecorationsWidth: 0,
				lineNumbersMinChars: 3,
			}}
		/>
	);
}

function ImageViewer({
	workspaceId,
	filePath,
}: { workspaceId: string; filePath: string }) {
	const url = gateway.workspace.rawUrl(workspaceId, filePath);
	return (
		<div className="flex items-center justify-center p-4 overflow-auto h-full">
			<img
				src={url}
				alt={filePath}
				className="max-w-full max-h-[70vh] object-contain rounded-lg"
			/>
		</div>
	);
}

function VideoViewer({
	workspaceId,
	filePath,
}: { workspaceId: string; filePath: string }) {
	const url = gateway.workspace.rawUrl(workspaceId, filePath);
	return (
		<div className="flex items-center justify-center p-4 h-full">
			<video src={url} controls className="max-w-full max-h-[70vh] rounded-lg">
				<track kind="captions" />
			</video>
		</div>
	);
}

function BinaryViewer({ filePath }: { filePath: string }) {
	const ext = filePath.split(".").pop()?.toUpperCase() ?? "FILE";
	return (
		<div className="flex flex-col items-center justify-center gap-2 p-8 h-full text-muted-foreground/50">
			<span className="rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wider bg-muted">
				{ext}
			</span>
			<p className="text-sm">Binary file — preview not available</p>
		</div>
	);
}

export function FileViewer({ workspaceId, filePath }: FileViewerProps) {
	const mime = guessMime(filePath);
	const isText = isTextMime(mime);
	const isImage = isImageMime(mime);
	const isVideo = isVideoMime(mime);

	return (
		<div className="h-full min-h-0 overflow-hidden">
			{isText && <MonacoViewer workspaceId={workspaceId} filePath={filePath} />}
			{isImage && <ImageViewer workspaceId={workspaceId} filePath={filePath} />}
			{isVideo && <VideoViewer workspaceId={workspaceId} filePath={filePath} />}
			{!isText && !isImage && !isVideo && <BinaryViewer filePath={filePath} />}
		</div>
	);
}
