import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useIntl } from "react-intl";
import { desktopMessages } from "@/i18n/messages";
import { useIcon } from "@/lib/icon-context";
import { Button } from "./button";

interface MessageScrollerProps {
	visible: boolean;
	onScrollToBottom(): void;
}

export function MessageScroller({ visible, onScrollToBottom }: MessageScrollerProps) {
	const intl = useIntl();
	const reducedMotion = useReducedMotion();
	const ChevronDownIcon = useIcon("chevron-down");
	const verticalOffset = reducedMotion ? 0 : 6;
	const transitionDuration = reducedMotion ? 0 : 0.18;
	const content = visible ? (
		<motion.div
			animate={{ opacity: 1, y: 0 }}
			className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2"
			exit={{ opacity: 0, y: verticalOffset }}
			initial={{ opacity: 0, y: verticalOffset }}
			transition={{ duration: transitionDuration, ease: "easeOut" }}
		>
			<Button
				aria-label={intl.formatMessage(desktopMessages.messageJumpLatest)}
				className="bg-background shadow-sm rounded-full"
				onClick={onScrollToBottom}
				size="icon-sm"
				title={intl.formatMessage(desktopMessages.messageJumpLatest)}
				type="button"
				variant="tertiary"
			>
				<ChevronDownIcon size={16} />
			</Button>
		</motion.div>
	) : null;

	return <AnimatePresence initial={false}>{content}</AnimatePresence>;
}
