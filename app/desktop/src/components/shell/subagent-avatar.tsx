import { Blobatar } from "@blobatar/react";
import { cn } from "cn";
import type { DesktopSubagentItem } from "../../../shared/desktop-rpc";

/**
 * Every delegated task gets a stable face: the seed is the tool call id, so the
 * same subagent looks identical in the transcript row, the dock list and after
 * a session reload. Rendered static (one <img>) with the tone pinned mid-range,
 * so faces read as saturated dots at 20px instead of pale or inky blobs. Status
 * is carried by the text next to it, never by the face.
 */
export function SubagentAvatar({
	item,
	size,
	className,
}: {
	readonly item: Pick<DesktopSubagentItem, "toolCallId">;
	readonly size: number;
	readonly className?: string;
}) {
	return (
		<Blobatar
			name={item.toolCallId}
			size={size}
			tone={0.55}
			palette={{ eye: "#ffffff" }}
			aria-hidden="true"
			className={cn("shrink-0 select-none", className)}
		/>
	);
}
