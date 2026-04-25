import type { CapsuleSandboxToHostMessage } from "@jayden/jai-capsule-protocol";
import { useEffect, useMemo, useRef } from "react";
import { buildSandboxHTML } from "./sandbox-html";

export interface CapsuleHostProps {
	instanceId: string;
	bundleCode: string;
	data: unknown;
	theme?: "light" | "dark";
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
	onReady,
	onError,
	onResize,
	className,
	style,
}: CapsuleHostProps): React.ReactElement {
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	const callbacksRef = useRef({ onReady, onError, onResize });
	callbacksRef.current = { onReady, onError, onResize };

	const srcDoc = useMemo(
		() => buildSandboxHTML({ instanceId, initialData: data, theme, bundleCode }),
		[instanceId, bundleCode, data, theme],
	);

	useEffect(() => {
		const iframe = iframeRef.current;
		if (!iframe) return;

		const handleMessage = (e: MessageEvent<CapsuleSandboxToHostMessage>) => {
			if (e.source !== iframe.contentWindow) return;
			const m = e.data;
			if (!m || typeof m !== "object") return;
			if (m.instanceId !== instanceId) return;

			switch (m.type) {
				case "capsule/ready":
					callbacksRef.current.onReady?.();
					break;
				case "capsule/error":
					callbacksRef.current.onError?.(m.message, m.stack);
					break;
				case "capsule/resize":
					callbacksRef.current.onResize?.(m.width, m.height);
					break;
			}
		};

		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
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
