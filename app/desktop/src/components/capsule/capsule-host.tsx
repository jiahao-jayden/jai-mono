import type {
	CapsuleActionResultMessage,
	CapsuleSandboxToHostMessage,
	CapsuleUpdateMessage,
} from "@jayden/jai-capsule-protocol";
import { useEffect, useMemo, useRef } from "react";
import { buildSandboxHTML } from "./sandbox-html";

export interface CapsuleHostProps {
	instanceId: string;
	bundleCode: string;
	data: unknown;
	theme?: "light" | "dark";
	onAction?: (actionId: string, args: unknown) => unknown | Promise<unknown>;
	onReady?: () => void;
	onError?: (message: string, stack?: string) => void;
	onResize?: (width?: number, height?: number) => void;
	className?: string;
	style?: React.CSSProperties;
}

export function CapsuleHost({
	instanceId,
	bundleCode,
	data,
	theme,
	onAction,
	onReady,
	onError,
	onResize,
	className,
	style,
}: CapsuleHostProps): React.ReactElement {
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const readyRef = useRef(false);
	const latestDataRef = useRef<unknown>(data);
	const dataAtMountRef = useRef<unknown>(data);

	const callbacksRef = useRef({ onAction, onReady, onError, onResize });
	callbacksRef.current = { onAction, onReady, onError, onResize };

	// `data` is excluded on purpose: it is baked into srcDoc on mount and
	// streamed via capsule/update afterwards.
	// biome-ignore lint/correctness/useExhaustiveDependencies: remount keys only
	const srcDoc = useMemo(
		() => buildSandboxHTML({ instanceId, initialData: data, theme, bundleCode }),
		[instanceId, bundleCode, theme],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: srcDoc is the remount key
	useEffect(() => {
		readyRef.current = false;
		dataAtMountRef.current = latestDataRef.current;
	}, [srcDoc]);

	useEffect(() => {
		latestDataRef.current = data;
		if (!readyRef.current) return;
		const win = iframeRef.current?.contentWindow;
		if (!win) return;
		const msg: CapsuleUpdateMessage = { type: "capsule/update", instanceId, data };
		win.postMessage(msg, "*");
	}, [data, instanceId]);

	useEffect(() => {
		const iframe = iframeRef.current;
		if (!iframe) return;

		const handleMessage = (e: MessageEvent<CapsuleSandboxToHostMessage>) => {
			if (e.source !== iframe.contentWindow) return;
			const m = e.data;
			if (!m || typeof m !== "object") return;
			if (m.instanceId !== instanceId) return;

			switch (m.type) {
				case "capsule/ready": {
					readyRef.current = true;
					callbacksRef.current.onReady?.();
					if (!Object.is(latestDataRef.current, dataAtMountRef.current)) {
						const win = iframe.contentWindow;
						if (win) {
							const msg: CapsuleUpdateMessage = {
								type: "capsule/update",
								instanceId,
								data: latestDataRef.current,
							};
							win.postMessage(msg, "*");
						}
					}
					break;
				}
				case "capsule/action": {
					const handler = callbacksRef.current.onAction;
					const win = iframe.contentWindow;
					if (!win) return;
					if (!handler) {
						const reply: CapsuleActionResultMessage = {
							type: "capsule/action_result",
							instanceId,
							requestId: m.requestId,
							ok: false,
							error: "no-action-handler",
						};
						win.postMessage(reply, "*");
						return;
					}
					Promise.resolve()
						.then(() => handler(m.actionId, m.args))
						.then((result) => {
							const reply: CapsuleActionResultMessage = {
								type: "capsule/action_result",
								instanceId,
								requestId: m.requestId,
								ok: true,
								result,
							};
							win.postMessage(reply, "*");
						})
						.catch((err: unknown) => {
							const reply: CapsuleActionResultMessage = {
								type: "capsule/action_result",
								instanceId,
								requestId: m.requestId,
								ok: false,
								error: err instanceof Error ? err.message : String(err),
							};
							win.postMessage(reply, "*");
						});
					break;
				}
				case "capsule/error":
					callbacksRef.current.onError?.(m.message, m.stack);
					break;
				case "capsule/resize":
					callbacksRef.current.onResize?.(m.width, m.height);
					break;
			}
		};

		window.addEventListener("message", handleMessage);
		return () => {
			window.removeEventListener("message", handleMessage);
		};
	}, [instanceId]);

	return (
		<iframe
			ref={iframeRef}
			srcDoc={srcDoc}
			sandbox="allow-scripts"
			title={`capsule:${instanceId}`}
			className={className}
			style={{ width: "100%", height: "100%", border: 0, display: "block", background: "transparent", ...style }}
		/>
	);
}
