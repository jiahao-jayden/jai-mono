import type { DesktopSlashInvocation } from "../../../shared/desktop-rpc";

interface SlashInvocationTextProps {
	readonly text: string;
	readonly invocation: DesktopSlashInvocation;
}

export function SlashInvocationText({ text, invocation }: SlashInvocationTextProps) {
	const token = `/${invocation.name}`;
	if (!text.startsWith(token)) return text;

	return (
		<>
			<span
				className="slash-invocation"
				data-kind={invocation.kind}
				data-note={invocation.displayName}
				title={invocation.displayName}
			>
				{token}
			</span>
			{text.slice(token.length)}
		</>
	);
}
