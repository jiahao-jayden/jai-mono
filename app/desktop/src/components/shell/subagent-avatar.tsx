import Avatar from "boring-avatars";
import { cn } from "cn";
import type { DesktopSubagentItem } from "../../../shared/desktop-rpc";

/**
 * Every delegated task gets a stable face: the seed is the tool call id, so the
 * same subagent looks identical in the transcript row, the dock list and after
 * a session reload. Status is carried by the text next to it, never by the face.
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
	const seed = `jai-subagent-v1:${item.toolCallId}`;
	const colors = ["#F07818", "#FFB477", "#FFD7B5", "#F0F0F0", "#DCE5E0"];

	return (
		<Avatar
			name={seed}
			colors={colors}
			variant="beam"
			size={size}
			aria-hidden="true"
			className={cn("shrink-0 select-none rounded-full", className)}
		/>
	);
}
