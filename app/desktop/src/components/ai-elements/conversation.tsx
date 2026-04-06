import { ArrowDownIcon, MessageSquareIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ConversationProps = ComponentProps<"div">;

export const Conversation = ({ className, children, ...props }: ConversationProps) => {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [showScrollButton, setShowScrollButton] = useState(false);
	const isAtBottomRef = useRef(true);

	const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
		const el = scrollRef.current;
		if (el) el.scrollTo({ top: el.scrollHeight, behavior });
	}, []);

	const handleScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el) return;
		const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
		isAtBottomRef.current = atBottom;
		setShowScrollButton(!atBottom);
	}, []);

	useEffect(() => {
		if (isAtBottomRef.current) {
			scrollToBottom("instant");
		}
	});

	return (
		<div className="relative flex-1 min-h-0">
			<div
				ref={scrollRef}
				className={cn("h-full overflow-y-auto", className)}
				onScroll={handleScroll}
				{...props}
			>
				{children}
			</div>
			{showScrollButton && <ConversationScrollButton onClick={() => scrollToBottom()} />}
		</div>
	);
};

export type ConversationContentProps = ComponentProps<"div">;

export const ConversationContent = ({ className, children, ...props }: ConversationContentProps) => (
	<div className={cn("flex flex-col gap-6 p-4 md:p-8", className)} {...props}>
		{children}
	</div>
);

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
	icon?: ReactNode;
	title?: string;
	description?: string;
};

export const ConversationEmptyState = ({
	icon,
	title = "开始对话",
	description = "在下方输入消息开始与 Noa 交流",
	className,
	children,
	...props
}: ConversationEmptyStateProps) => (
	<div
		className={cn(
			"flex flex-col items-center justify-center gap-3 py-20 text-center text-muted-foreground",
			className,
		)}
		{...props}
	>
		<div className="text-muted-foreground/50">{icon ?? <MessageSquareIcon className="size-10" />}</div>
		<div className="space-y-1">
			<p className="text-sm font-medium text-foreground">{title}</p>
			<p className="text-xs">{description}</p>
		</div>
		{children}
	</div>
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({ className, ...props }: ConversationScrollButtonProps) => (
	<Button
		className={cn(
			"absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-md",
			className,
		)}
		size="icon-sm"
		variant="secondary"
		{...props}
	>
		<ArrowDownIcon className="size-4" />
	</Button>
);
