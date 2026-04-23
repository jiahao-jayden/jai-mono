import Editor, { type OnMount } from "@monaco-editor/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { WandSparklesIcon } from "lucide-react";
import type { editor as MonacoEditorNS, Uri as MonacoUri } from "monaco-editor";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useIsDark } from "@/hooks/use-is-dark";
import { registerPluginSchema, schemaModelPath, unregisterPluginSchema } from "@/lib/monaco-schema-registry";
import { cn } from "@/lib/utils";
import { gateway } from "@/services/gateway";

interface ConfigEditorProps {
	pluginName: string;
	config: unknown;
	configSchema?: Record<string, unknown> | null;
}

type MonacoEditor = Parameters<OnMount>[0];
type MonacoNS = Parameters<OnMount>[1];

interface SchemaMarker {
	message: string;
	line: number;
}

function stringify(value: unknown): string {
	if (value === undefined || value === null) return "";
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return "";
	}
}

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 360;

export function ConfigEditor({ pluginName, config, configSchema }: ConfigEditorProps) {
	const qc = useQueryClient();
	const initial = stringify(config);
	const [text, setText] = useState(initial);
	const [parseError, setParseError] = useState<string | null>(null);
	const [savedPulse, setSavedPulse] = useState(0);
	const [height, setHeight] = useState(MIN_HEIGHT);
	const [schemaMarkers, setSchemaMarkers] = useState<SchemaMarker[]>([]);
	const lastSavedRef = useRef(initial);
	const editorRef = useRef<MonacoEditor | null>(null);
	const markersDisposableRef = useRef<{ dispose(): void } | null>(null);
	const isDark = useIsDark();

	useEffect(() => {
		setText(initial);
		lastSavedRef.current = initial;
	}, [initial]);

	useEffect(() => {
		registerPluginSchema(pluginName, configSchema ?? null);
		return () => unregisterPluginSchema(pluginName);
	}, [pluginName, configSchema]);

	const mutation = useMutation({
		mutationFn: gateway.config.update,
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["config"] });
			qc.invalidateQueries({ queryKey: ["plugins"] });
			setSavedPulse((n) => n + 1);
		},
	});

	const dirty = text !== lastSavedRef.current;

	const handleMount: OnMount = useCallback((editor, monaco: MonacoNS) => {
		editorRef.current = editor;

		const updateHeight = () => {
			const h = Math.min(Math.max(editor.getContentHeight(), MIN_HEIGHT), MAX_HEIGHT);
			setHeight(h);
		};
		updateHeight();
		editor.onDidContentSizeChange(updateHeight);

		const readMarkers = () => {
			const model = editor.getModel();
			if (!model) return;
			const all: MonacoEditorNS.IMarker[] = monaco.editor.getModelMarkers({ resource: model.uri });
			setSchemaMarkers(
				all
					.filter((m) => m.severity === monaco.MarkerSeverity.Error)
					.map((m) => ({ message: m.message, line: m.startLineNumber })),
			);
		};
		readMarkers();
		markersDisposableRef.current?.dispose();
		markersDisposableRef.current = monaco.editor.onDidChangeMarkers((uris: readonly MonacoUri[]) => {
			const model = editor.getModel();
			if (!model) return;
			const uri = model.uri.toString();
			if (uris.some((u) => u.toString() === uri)) readMarkers();
		});
	}, []);

	useEffect(() => {
		return () => {
			markersDisposableRef.current?.dispose();
			markersDisposableRef.current = null;
		};
	}, []);

	const handleFormat = useCallback(async () => {
		const editor = editorRef.current;
		if (!editor) return;
		const trimmed = editor.getValue().trim();
		if (trimmed.length === 0) return;

		try {
			const pretty = JSON.stringify(JSON.parse(trimmed), null, 2);
			const model = editor.getModel();
			if (model && pretty !== editor.getValue()) {
				editor.pushUndoStop();
				editor.executeEdits("format-json", [
					{
						range: model.getFullModelRange(),
						text: pretty,
						forceMoveMarkers: true,
					},
				]);
				editor.pushUndoStop();
			}
			setParseError(null);
		} catch (err) {
			setParseError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	const hasSchemaErrors = schemaMarkers.length > 0;

	const handleSave = () => {
		if (hasSchemaErrors) return;
		const trimmed = text.trim();
		let parsed: unknown;
		if (trimmed.length > 0) {
			try {
				parsed = JSON.parse(trimmed);
			} catch (err) {
				setParseError(err instanceof Error ? err.message : String(err));
				return;
			}
		}
		setParseError(null);
		lastSavedRef.current = text;
		mutation.mutate({ plugins: { [pluginName]: parsed ?? null } });
	};

	const handleReset = () => {
		setText(initial);
		setParseError(null);
		lastSavedRef.current = initial;
	};

	return (
		<div className="space-y-3">
			<div className="flex items-baseline justify-between gap-3">
				<h3 className="text-[10.5px] font-medium uppercase tracking-[0.15em] text-muted-foreground/60">
					Configuration
				</h3>
				<p className="text-[11px] text-muted-foreground/50 truncate">
					<span className="font-mono">settings.json</span> → plugins.{pluginName}
				</p>
			</div>

			<div
				className={cn(
					"overflow-hidden rounded-md border bg-background transition-colors",
					parseError || hasSchemaErrors ? "border-destructive/60" : "border-border/60",
				)}
			>
				<Editor
					height={height}
					language="json"
					path={schemaModelPath(pluginName)}
					value={text}
					theme={isDark ? "vs-dark" : "vs"}
					onChange={(value) => {
						setText(value ?? "");
						if (parseError) setParseError(null);
					}}
					onMount={handleMount}
					options={{
						minimap: { enabled: false },
						scrollBeyondLastLine: false,
						fontSize: 12.5,
						lineHeight: 20,
						lineNumbers: "on",
						renderLineHighlight: "none",
						overviewRulerBorder: false,
						overviewRulerLanes: 0,
						hideCursorInOverviewRuler: true,
						scrollbar: {
							verticalScrollbarSize: 6,
							horizontalScrollbarSize: 6,
							verticalSliderSize: 6,
						},
						padding: { top: 6, bottom: 6 },
						wordWrap: "on",
						folding: true,
						glyphMargin: false,
						lineDecorationsWidth: 4,
						lineNumbersMinChars: 2,
						tabSize: 2,
						formatOnPaste: true,
						automaticLayout: true,
					}}
				/>
			</div>

			{parseError && (
				<p className="font-serif italic text-[12px] text-destructive/85">JSON 解析失败：{parseError}</p>
			)}

			{!parseError && hasSchemaErrors && (
				<ul className="space-y-0.5 font-serif italic text-[12px] text-destructive/85">
					{schemaMarkers.slice(0, 5).map((m) => (
						<li key={`${m.line}-${m.message}`}>
							<span className="font-mono not-italic text-[11px] text-destructive/70 mr-1.5">L{m.line}</span>
							{m.message}
						</li>
					))}
					{schemaMarkers.length > 5 && (
						<li className="text-destructive/60">…还有 {schemaMarkers.length - 5} 条校验错误</li>
					)}
				</ul>
			)}

			{mutation.isError && !parseError && !hasSchemaErrors && (
				<p className="font-serif italic text-[12px] text-destructive/85">
					保存失败：{mutation.error instanceof Error ? mutation.error.message : String(mutation.error)}
				</p>
			)}

			<div className="flex items-center gap-2">
				<Button
					type="button"
					size="sm"
					variant="default"
					onClick={handleSave}
					disabled={!dirty || mutation.isPending || hasSchemaErrors}
					className="h-7 px-3 text-[12px]"
					title={hasSchemaErrors ? "存在 schema 校验错误，先修复再保存" : undefined}
				>
					{mutation.isPending ? "保存中…" : "保存"}
				</Button>
				{dirty && (
					<Button
						type="button"
						size="sm"
						variant="ghost"
						onClick={handleReset}
						className="h-7 px-2 text-[12px] text-muted-foreground/70"
					>
						取消
					</Button>
				)}
				<Button
					type="button"
					size="sm"
					variant="ghost"
					onClick={handleFormat}
					disabled={text.trim().length === 0}
					className="h-7 gap-1.5 px-2 text-[12px] text-muted-foreground/70 ml-auto"
					title="格式化 JSON"
				>
					<WandSparklesIcon className="h-3.5 w-3.5" />
					Format
				</Button>
				<SavedPulse key={savedPulse} visible={savedPulse > 0} />
			</div>
		</div>
	);
}

function SavedPulse({ visible }: { visible: boolean }) {
	if (!visible) return null;
	return (
		<motion.span
			initial={{ opacity: 0, y: 2 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0 }}
			transition={{ duration: 0.3 }}
			className="text-[11.5px] font-serif italic text-primary/80"
		>
			已保存
		</motion.span>
	);
}
