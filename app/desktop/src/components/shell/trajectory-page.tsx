import { TrajectoryView } from "@jai/trajectory-ui";
import "@jai/trajectory-ui/style.css";
import { useMemo, useState } from "react";
import { createDesktopTrajectoryDataSource } from "@/lib/desktop-trajectory";
import { useIcons } from "@/lib/icon-context";
import { Button } from "../ui/button";

export function TrajectoryPage({ sessionId, onBack }: { readonly sessionId: string; readonly onBack: () => void }) {
	const icons = useIcons();
	const ArrowLeftIcon = icons["arrow-left"];
	const EyeIcon = icons.eye;
	const EyeOffIcon = icons["eye-off"];
	const [showFinalText, setShowFinalText] = useState(false);
	const source = useMemo(
		() => createDesktopTrajectoryDataSource(showFinalText ? ["final_text"] : []),
		[showFinalText],
	);
	const ContentScopeIcon = showFinalText ? EyeOffIcon : EyeIcon;
	const contentScopeLabel = showFinalText ? "隐藏最终文本" : "显示最终文本";
	return (
		<section className="flex min-w-0 flex-1 flex-col bg-background">
			<header className="flex h-13 shrink-0 items-center justify-between border-b border-border px-5">
				<Button type="button" variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground">
					<ArrowLeftIcon size={16} />
					返回会话
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={() => setShowFinalText((visible) => !visible)}
					aria-pressed={showFinalText}
					className="text-muted-foreground"
				>
					<ContentScopeIcon size={16} />
					{contentScopeLabel}
				</Button>
			</header>
			<div className="min-h-0 flex-1 overflow-auto">
				<TrajectoryView source={source} sessionId={sessionId} />
			</div>
		</section>
	);
}
