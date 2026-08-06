"use client";

import {
	Cancel01Icon,
	Copy01Icon,
	Download04Icon,
	SquareArrowExpand01Icon,
	Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { forwardRef, memo, type ReactNode, type SVGProps } from "react";
import { motion, type HTMLMotionProps, useReducedMotion } from "framer-motion";
import { Streamdown } from "streamdown";
import { cn } from "@/lib/utils";
import { spring } from "@/lib/springs";
import { useShape } from "@/lib/shape-context";
import { remarkDisableSetextH2 } from "@/lib/remark-disable-setext-h2";
import { useTouchPrimary } from "@/hooks/use-touch-primary";
import { FileThumbnail } from "@/components/ui/file-thumbnail";

const streamdownPlugins = { cjk, code };
const streamdownRemarkPlugins = [remarkDisableSetextH2];
const streamdownControls = {
	code: { copy: true, download: false },
	table: { copy: true, download: true, fullscreen: true },
};

type StreamdownIconProps = SVGProps<SVGSVGElement> & { size?: number };

function makeStreamdownIcon(icon: Parameters<typeof HugeiconsIcon>[0]["icon"]) {
	return function StreamdownIcon({ size = 16, strokeWidth: _strokeWidth, ...props }: StreamdownIconProps) {
		return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.6} {...props} />;
	};
}

const streamdownIcons = {
	CheckIcon: makeStreamdownIcon(Tick02Icon),
	CopyIcon: makeStreamdownIcon(Copy01Icon),
	DownloadIcon: makeStreamdownIcon(Download04Icon),
	Maximize2Icon: makeStreamdownIcon(SquareArrowExpand01Icon),
	XIcon: makeStreamdownIcon(Cancel01Icon),
};

const AssistantMarkdown = memo(function AssistantMarkdown({
	content,
	isStreaming,
}: {
	content: string;
	isStreaming: boolean;
}) {
	return (
		<Streamdown
			aria-live="off"
			className="chat-markdown"
			controls={streamdownControls}
			icons={streamdownIcons}
			isAnimating={isStreaming}
			mode={isStreaming ? "streaming" : "static"}
			plugins={streamdownPlugins}
			remarkPlugins={streamdownRemarkPlugins}
		>
			{content}
		</Streamdown>
	);
});

interface ChatMessageProps
  extends Omit<HTMLMotionProps<"div">, "children"> {
  /** Who sent the message. Drives alignment and bubble colour:
   *  `user` → right-aligned accent bubble, `assistant` → left-aligned plain text. */
  from: "user" | "assistant";
  /** Optional attachments rendered as square thumbnails above the bubble. */
  files?: File[];
  /** Side length of each attachment thumbnail in pixels. Defaults to 64. */
  thumbnailSize?: number;
  /** Timestamp shown in the hover-revealed meta row, before the actions.
   *  User-message only — ignored on assistant replies. Caller pre-formats it
   *  (e.g. `"Wednesday 6:08 PM"`). */
  time?: ReactNode;
  /** Icon-only action buttons shown in the hover-revealed meta row (e.g. copy,
   *  edit, regenerate). Rendered next to the timestamp. */
  actions?: ReactNode;
  /** Enables partial Markdown handling while an assistant response streams. */
  isStreaming?: boolean;
  /** Plays the entrance transition for messages appended after the initial transcript snapshot. */
  animate?: boolean;
  /** Message body. When omitted the text bubble is dropped (attachment-only message). */
  children?: ReactNode;
}

// ─── ChatMessage ──────────────────────────────────────────────────────────
// A single transcript entry with baked-in entrance + layout motion. Pairs with
// InputMessage's onSend: render one per sent/received message. `layout="position"`
// lets earlier messages slide up smoothly when a new one is appended.
const ChatMessage = forwardRef<HTMLDivElement, ChatMessageProps>(
  (
    {
      from,
      files,
      thumbnailSize = 64,
      time,
      actions,
      isStreaming = false,
      animate = true,
      children,
      className,
      ...props
    },
    ref
  ) => {
    const shape = useShape();
    const isUser = from === "user";
    const reducedMotion = useReducedMotion();
    const shouldAnimate = animate && !reducedMotion;
    // Hover-reveal is unreachable on touch — keep the meta row visible there.
    const isTouch = useTouchPrimary();
    // Timestamps are a user-message affordance; assistant replies show actions only.
    const showTime = isUser && time != null;

    return (
      <motion.div
        ref={ref}
        role="article"
        aria-label={isUser ? "Your message" : "Assistant response"}
        layout={shouldAnimate ? "position" : false}
        initial={shouldAnimate ? { opacity: 0, y: 8 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={shouldAnimate ? spring.moderate : { duration: 0 }}
        className={cn(
          "group flex max-w-[80%] flex-col gap-1.5",
          isUser ? "items-end self-end" : "items-start self-start",
          !isUser && "w-full min-w-0",
          className
        )}
        {...props}
      >
        {files && files.length > 0 && (
          <div
            className={cn(
              "flex flex-wrap gap-1.5",
              isUser ? "justify-end" : "justify-start"
            )}
          >
            {files.map((file, i) => (
              <FileThumbnail
                key={`${file.name}-${file.size}-${file.lastModified}-${i}`}
                file={file}
                size={thumbnailSize}
              />
            ))}
          </div>
        )}
        {children != null && children !== "" && (
          <div
            className={cn(
              "min-w-0 py-2 text-[14px] wrap-break-word",
              !isUser && "w-full",
              // User keeps the bubble chrome (rounded fill + horizontal padding);
              // the assistant reply is flush-left plain text with no background.
              isUser
                ? cn(
                    shape.bg,
                    // `text-pretty` is reserved for settled user bubbles. On the
                    // assistant reply it's left off on purpose: `text-wrap: pretty`
                    // re-balances the last lines on every content change, so a
                    // word-by-word stream visibly reflows earlier words to new
                    // lines. Default (normal) wrapping appends left-to-right and
                    // stays put as the text grows.
                    "px-3.5 text-pretty whitespace-pre-wrap bg-[color-mix(in_oklab,var(--accent),var(--background)_45%)] text-accent-foreground"
                  )
                : "text-foreground/95 leading-[1.7]"
            )}
          >
            {!isUser && typeof children === "string" ? (
              <AssistantMarkdown content={children} isStreaming={isStreaming} />
            ) : (
              children
            )}
          </div>
        )}
        {!isUser ? (
          <span className="sr-only" role="status">
            {isStreaming ? "Assistant is responding" : "Assistant response complete"}
          </span>
        ) : null}
        {(showTime || actions != null) && (
          // Meta row: timestamp + icon-only actions. Always rendered (so it
          // reserves its height and the gap between bubbles never shifts) but
          // hidden until the message is hovered or an action is focused.
          // The timestamp is a user-message affordance only — assistant replies
          // show their actions alone. User rows read date → icons left-to-right.
          <div
            className={cn(
              "flex items-center gap-2 px-1 text-[12px] leading-none text-muted-foreground select-none",
              !isTouch && [
                "opacity-0 pointer-events-none transition-opacity duration-150",
                "group-hover:opacity-100 group-hover:pointer-events-auto",
                "group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
              ]
            )}
          >
            {showTime && <span className="tabular-nums">{time}</span>}
            {actions != null && (
              <span className="flex items-center gap-0.5">{actions}</span>
            )}
          </div>
        )}
      </motion.div>
    );
  }
);

ChatMessage.displayName = "ChatMessage";

export { ChatMessage };
export type { ChatMessageProps };
export default ChatMessage;
