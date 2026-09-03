import { useState } from "react";
import { useIcon } from "@/lib/icon-context";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";

interface ApiKeyInputProps {
	readonly value: string;
	readonly credentialConfigured: boolean;
	readonly credentialMask?: string;
	readonly disabled?: boolean;
	readonly onReveal: () => Promise<string>;
	readonly onChange: (value: string) => void;
	readonly label: string;
	readonly showLabel: string;
	readonly hideLabel: string;
	readonly revealErrorLabel: string;
	readonly replacementPlaceholder: string;
	readonly enterPlaceholder: string;
}

export function ApiKeyInput({
	value,
	credentialConfigured,
	credentialMask,
	disabled = false,
	onReveal,
	onChange,
	label,
	showLabel,
	hideLabel,
	revealErrorLabel,
	replacementPlaceholder,
	enterPlaceholder,
}: ApiKeyInputProps) {
	const KeyIcon = useIcon("key");
	const EyeIcon = useIcon("eye");
	const EyeOffIcon = useIcon("eye-off");
	const [revealed, setRevealed] = useState(false);
	const [revealedKey, setRevealedKey] = useState<string>();
	const [revealing, setRevealing] = useState(false);
	const [revealError, setRevealError] = useState<string>();
	const VisibilityIcon = revealed ? EyeOffIcon : EyeIcon;
	const visibilityLabel = revealed ? hideLabel : showLabel;

	if (credentialConfigured) {
		const toggleReveal = async () => {
			if (revealed) {
				setRevealed(false);
				setRevealedKey(undefined);
				return;
			}
			if (value) {
				setRevealed(true);
				return;
			}
			setRevealing(true);
			setRevealError(undefined);
			try {
				setRevealedKey(await onReveal());
				setRevealed(true);
			} catch {
				setRevealError(revealErrorLabel);
			} finally {
				setRevealing(false);
			}
		};
		const visibleValue = value || revealedKey || "";
		const maskedValue = value ? maskApiKey(value) : (credentialMask ?? "••••");
		return (
			<div className="flex flex-col gap-1">
				<div className="relative">
					<KeyIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
					{revealed ? (
						<Input
							type="text"
							value={visibleValue}
							disabled={disabled}
							onChange={(event) => onChange(event.target.value)}
							className="px-10 font-mono text-[12px]"
							aria-label={label}
							autoComplete="off"
							spellCheck={false}
						/>
					) : (
						<div className="flex h-9 items-center rounded-lg border border-input bg-input/20 px-10">
							<code className="text-[12px] text-muted-foreground">{maskedValue}</code>
						</div>
					)}
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="absolute top-1/2 right-0.5 -translate-y-1/2"
						loading={revealing}
						disabled={disabled}
						onClick={() => void toggleReveal()}
						aria-label={visibilityLabel}
						title={visibilityLabel}
					>
						<VisibilityIcon />
					</Button>
				</div>
				{revealError ? (
					<p className="text-[11px] text-destructive" role="alert">
						{revealError}
					</p>
				) : null}
			</div>
		);
	}

	return (
		<div className="relative">
			<KeyIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				type={revealed ? "text" : "password"}
				value={value}
				disabled={disabled}
				onChange={(event) => onChange(event.target.value)}
				placeholder={credentialConfigured ? replacementPlaceholder : enterPlaceholder}
				className="px-10"
				aria-label={label}
				autoComplete="new-password"
				spellCheck={false}
			/>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="absolute top-1/2 right-0.5 -translate-y-1/2"
				disabled={disabled || !value}
				onClick={() => setRevealed((current) => !current)}
				aria-label={visibilityLabel}
				title={visibilityLabel}
			>
				<VisibilityIcon />
			</Button>
		</div>
	);
}

function maskApiKey(value: string): string {
	return `•••• ${value.slice(-4)}`;
}
