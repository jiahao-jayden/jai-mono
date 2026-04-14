import { AlertCircleIcon } from "lucide-react";
import { MessageAssistant } from "./message-assistant";

export function StreamingPlaceholder() {
	return (
		<MessageAssistant>
			<div className="flex items-center gap-2 py-2">
				<span className="size-2 rounded-full bg-foreground/30 animate-[bounce_1.4s_ease-in-out_infinite]" />
				<span className="size-2 rounded-full bg-foreground/30 animate-[bounce_1.4s_ease-in-out_0.2s_infinite]" />
				<span className="size-2 rounded-full bg-foreground/30 animate-[bounce_1.4s_ease-in-out_0.4s_infinite]" />
			</div>
		</MessageAssistant>
	);
}

export function ErrorBlock({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
			<AlertCircleIcon className="size-4 mt-0.5 shrink-0" />
			<span>{children}</span>
		</div>
	);
}

export function TypingIndicator() {
	return (
		<div className="flex items-center gap-2 py-2">
			<span className="size-2 rounded-full bg-foreground/30 animate-[bounce_1.4s_ease-in-out_infinite]" />
			<span className="size-2 rounded-full bg-foreground/30 animate-[bounce_1.4s_ease-in-out_0.2s_infinite]" />
			<span className="size-2 rounded-full bg-foreground/30 animate-[bounce_1.4s_ease-in-out_0.4s_infinite]" />
		</div>
	);
}
