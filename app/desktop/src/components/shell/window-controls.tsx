import { useState, useSyncExternalStore } from "react";
import { desktop } from "@/lib/desktop";

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

function subscribeToWindowFocus(onStoreChange: () => void): () => void {
	window.addEventListener("focus", onStoreChange);
	window.addEventListener("blur", onStoreChange);
	return () => {
		window.removeEventListener("focus", onStoreChange);
		window.removeEventListener("blur", onStoreChange);
	};
}

function getWindowFocusSnapshot(): boolean {
	return document.hasFocus();
}

export function WindowControls() {
	const focused = useSyncExternalStore(subscribeToWindowFocus, getWindowFocusSnapshot, () => true);
	const [hovered, setHovered] = useState(false);
	const blurred = !focused && !hovered;

	return (
		<fieldset
			aria-label="窗口控制"
			className="m-0 flex items-center gap-2 border-0 p-0"
			style={noDrag}
			onDoubleClick={(event) => event.stopPropagation()}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<TrafficButton
				activeColor="#BF4740"
				blurred={blurred}
				color="#FF5F57"
				label="关闭"
				showIcon={hovered}
				onClick={() => desktop.window.close()}
			>
				<CloseIcon />
			</TrafficButton>
			<TrafficButton
				activeColor="#BF9123"
				blurred={blurred}
				color="#FEBC2E"
				label="最小化"
				showIcon={hovered}
				onClick={() => desktop.window.minimize()}
			>
				<MinimizeIcon />
			</TrafficButton>
			<TrafficButton
				activeColor="#1F9A31"
				blurred={blurred}
				color="#28C840"
				label="全屏"
				showIcon={hovered}
				onClick={() => desktop.window.fullscreen()}
			>
				<FullscreenIcon />
			</TrafficButton>
		</fieldset>
	);
}

function TrafficButton({
	activeColor,
	blurred,
	children,
	color,
	label,
	onClick,
	showIcon,
}: {
	activeColor: string;
	blurred: boolean;
	children: React.ReactNode;
	color: string;
	label: string;
	onClick: () => void;
	showIcon: boolean;
}) {
	const [pressed, setPressed] = useState(false);
	const background = blurred ? "#DCDCDC" : pressed ? activeColor : color;
	const borderColor = blurred ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.18)";

	return (
		<button
			aria-label={label}
			className="relative flex size-3 items-center justify-center rounded-full"
			style={{ background, border: `0.5px solid ${borderColor}` }}
			type="button"
			onClick={onClick}
			onMouseDown={() => setPressed(true)}
			onMouseLeave={() => setPressed(false)}
			onMouseUp={() => setPressed(false)}
		>
			{showIcon && !blurred ? children : null}
		</button>
	);
}

function CloseIcon() {
	return (
		<svg aria-hidden="true" fill="none" height="6" viewBox="0 0 6 6" width="6">
			<path d="M0.5 0.5L5.5 5.5M5.5 0.5L0.5 5.5" stroke="rgba(0,0,0,0.65)" strokeLinecap="round" strokeWidth="1.1" />
		</svg>
	);
}

function MinimizeIcon() {
	return (
		<svg aria-hidden="true" fill="none" height="6" viewBox="0 0 6 6" width="6">
			<path d="M0.5 3H5.5" stroke="rgba(0,0,0,0.65)" strokeLinecap="round" strokeWidth="1.1" />
		</svg>
	);
}

function FullscreenIcon() {
	return (
		<svg aria-hidden="true" fill="none" height="6" viewBox="0 0 8 8" width="6">
			<path d="M1 7L3.5 4.5M7 1L4.5 3.5" stroke="rgba(0,0,0,0.65)" strokeLinecap="round" strokeWidth="1.1" />
			<path
				d="M1 4.5V7H3.5M7 3.5V1H4.5"
				stroke="rgba(0,0,0,0.65)"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.1"
			/>
		</svg>
	);
}
