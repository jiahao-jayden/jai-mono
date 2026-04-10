import { useEffect, useState } from "react";
import { rpc } from "@/lib/rpc";

const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export function WindowControls() {
	const [focused, setFocused] = useState(document.hasFocus());
	const [hovered, setHovered] = useState(false);

	useEffect(() => {
		const onFocus = () => setFocused(true);
		const onBlur = () => setFocused(false);
		window.addEventListener("focus", onFocus);
		window.addEventListener("blur", onBlur);
		return () => {
			window.removeEventListener("focus", onFocus);
			window.removeEventListener("blur", onBlur);
		};
	}, []);

	const isBlur = !focused && !hovered;

	return (
		// biome-ignore lint/a11y/useSemanticElements: custom window controls
		<div
			role="group"
			className="flex items-center gap-2"
			style={noDrag}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<TrafficButton
				color="#FF5F57"
				activeColor="#BF4740"
				blur={isBlur}
				showIcon={hovered}
				onClick={() => rpc.window.close()}
				icon={<CloseIcon />}
			/>
			<TrafficButton
				color="#FEBC2E"
				activeColor="#BF9123"
				blur={isBlur}
				showIcon={hovered}
				onClick={() => rpc.window.minimize()}
				icon={<MinimizeIcon />}
			/>
			<TrafficButton
				color="#28C840"
				activeColor="#1F9A31"
				blur={isBlur}
				showIcon={hovered}
				onClick={() => rpc.window.fullscreen()}
				icon={<FullscreenIcon />}
			/>
		</div>
	);
}

function TrafficButton({
	color,
	activeColor,
	blur,
	showIcon,
	onClick,
	icon,
}: {
	color: string;
	activeColor: string;
	blur: boolean;
	showIcon: boolean;
	onClick: () => void;
	icon: React.ReactNode;
}) {
	const [pressed, setPressed] = useState(false);

	const bg = blur ? "#DCDCDC" : pressed ? activeColor : color;
	const borderColor = blur ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.18)";

	return (
		<button
			type="button"
			className="relative flex items-center justify-center rounded-full"
			style={{
				width: 12,
				height: 12,
				background: bg,
				border: `0.5px solid ${borderColor}`,
			}}
			onClick={onClick}
			onMouseDown={() => setPressed(true)}
			onMouseUp={() => setPressed(false)}
			onMouseLeave={() => setPressed(false)}
		>
			{showIcon && !blur && icon}
		</button>
	);
}

function CloseIcon() {
	return (
		<svg width="6" height="6" viewBox="0 0 6 6" fill="none" role="img" aria-label="close">
			<path d="M0.5 0.5L5.5 5.5M5.5 0.5L0.5 5.5" stroke="rgba(0,0,0,0.65)" strokeWidth="1.1" strokeLinecap="round" />
		</svg>
	);
}

function MinimizeIcon() {
	return (
		<svg width="6" height="6" viewBox="0 0 6 6" fill="none" role="img" aria-label="minimize">
			<path d="M0.5 3H5.5" stroke="rgba(0,0,0,0.65)" strokeWidth="1.1" strokeLinecap="round" />
		</svg>
	);
}

function FullscreenIcon() {
	return (
		<svg width="6" height="6" viewBox="0 0 8 8" fill="none" role="img" aria-label="fullscreen">
			<path d="M1 7L3.5 4.5M7 1L4.5 3.5" stroke="rgba(0,0,0,0.65)" strokeWidth="1.1" strokeLinecap="round" />
			<path
				d="M1 4.5V7H3.5M7 3.5V1H4.5"
				stroke="rgba(0,0,0,0.65)"
				strokeWidth="1.1"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}
