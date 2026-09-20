"use client";

import {
	forwardRef,
	isValidElement,
	memo,
	type HTMLAttributes,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { motion, type HTMLMotionProps, useReducedMotion } from "framer-motion";
import { useIntl } from "react-intl";
import type { ThemedToken } from "shiki";
import { desktopMessages } from "@/i18n/messages";
import { Streamdown } from "@lobehub/streamdown";
import remarkGfm from "remark-gfm";
import { cn } from "cn";
import { spring } from "@/lib/springs";
import { useShape } from "@/lib/shape-context";
import { remarkDisableSetextH2 } from "@/lib/remark-disable-setext-h2";
import { useTouchPrimary } from "@/hooks/use-touch-primary";
import { useIcon } from "@/lib/icon-context";
import { FileThumbnail } from "@/components/ui/file-thumbnail";
import { Button } from "@/components/ui/button";
import {
	createChatTokenStream,
	highlightChatCode,
	type ChatHighlightTheme,
} from "@/components/ui/chat-code-highlight";
import { useResolvedTheme } from "@/stores/theme";

const streamdownRemarkPlugins = [
	remarkGfm,
	remarkDisableSetextH2,
];

function CodeBlock({
	children,
	isStreaming = false,
}: HTMLAttributes<HTMLPreElement> & { readonly isStreaming?: boolean }) {
	const CopyIcon = useIcon("copy");
	const CheckIcon = useIcon("check");
	const [copied, setCopied] = useState(false);
	const theme = useResolvedTheme() === "dark" ? "github-dark" : "github-light";
	const codeElement = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children : undefined;
	const className = codeElement?.props.className;
	const language = className?.match(/language-(\S+)/)?.[1] ?? "";
	const value = String(codeElement?.props.children ?? children).replace(/\n$/, "");
	const highlighted = useChatCodeHighlight(value, language, theme, isStreaming);
	const copy = async () => {
		await navigator.clipboard.writeText(value);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1200);
	};
	const body =
		highlighted.html != null ? (
			<div dangerouslySetInnerHTML={{ __html: highlighted.html }} />
		) : (
			<pre>
				<code className={className}>
					{highlighted.tokens?.map((token, index) => (
						<span key={index} style={{ color: token.color }}>
							{token.content}
						</span>
					)) ?? value}
				</code>
			</pre>
		);

	return (
		<div data-streamdown="code-block">
			<div data-streamdown="code-block-header" data-language={language}>
				<span>{language}</span>
				<div data-streamdown="code-block-actions">
					<Button aria-label="Copy code" onClick={copy} size="icon-xs" variant="ghost" type="button">
						{copied ? <CheckIcon /> : <CopyIcon />}
					</Button>
				</div>
			</div>
			<div data-streamdown="code-block-body">{body}</div>
		</div>
	);
}

function MarkdownTable({ children, ...props }: HTMLAttributes<HTMLTableElement>) {
	return (
		<div data-streamdown="table-wrapper">
			<table {...props} data-streamdown="table">
				{children}
			</table>
		</div>
	);
}

function useChatCodeHighlight(
	value: string,
	language: string,
	theme: ChatHighlightTheme,
	isStreaming: boolean,
): { html?: string; tokens?: ThemedToken[] } {
	const [highlighted, setHighlighted] = useState<{ html?: string; tokens?: ThemedToken[] }>({});
	const streamRef = useRef<{
		language: string;
		theme: ChatHighlightTheme;
		sent: string;
		tokenizer: Awaited<ReturnType<typeof createChatTokenStream>>;
		tail: Promise<void>;
	} | null>(null);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			if (!isStreaming) {
				streamRef.current = null;
				const html = await highlightChatCode(value, language, theme);
				if (!cancelled) setHighlighted(html === undefined ? {} : { html });
				return;
			}
			const canAppend =
				streamRef.current != null &&
				streamRef.current.language === language &&
				streamRef.current.theme === theme &&
				streamRef.current.tokenizer != null &&
				value.startsWith(streamRef.current.sent);
			if (!canAppend) {
				streamRef.current = {
					language,
					theme,
					sent: "",
					tokenizer: await createChatTokenStream(language, theme),
					tail: Promise.resolve(),
				};
			}
			const session = streamRef.current;
			if (cancelled || session == null) return;
			session.tail = session.tail.then(async () => {
				if (cancelled) return;
				if (!session.tokenizer) {
					setHighlighted({});
					return;
				}
				const suffix = value.slice(session.sent.length);
				if (suffix) await session.tokenizer.enqueue(suffix);
				session.sent = value;
				if (!cancelled) {
					setHighlighted({
						tokens: [...session.tokenizer.tokensStable, ...session.tokenizer.tokensUnstable],
					});
				}
			});
		})();
		return () => {
			cancelled = true;
		};
	}, [isStreaming, language, theme, value]);

	return highlighted;
}

interface ChatMessageAttachment {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly size: number;
}

export const MarkdownContent = memo(function MarkdownContent({
	content,
	isStreaming = false,
	className,
}: {
	content: string;
	isStreaming?: boolean;
	className?: string;
}) {
	return (
		<div className={cn("chat-markdown", isStreaming && "chat-markdown-streaming", className)} aria-live="off">
			<Streamdown
				components={{
					pre: (props) => <CodeBlock {...props} isStreaming={isStreaming} />,
					table: MarkdownTable,
				}}
				granularity="word"
				smoothing="realtime"
				remarkPlugins={streamdownRemarkPlugins}
				content={content}
			/>
		</div>
	);
});

interface ChatMessageProps
  extends Omit<HTMLMotionProps<"div">, "children"> {
  /** Who sent the message. Drives alignment and bubble colour:
   *  `user` → right-aligned accent bubble, `assistant` → left-aligned plain text. */
  from: "user" | "assistant";
  /** Optional attachments rendered as square thumbnails above the bubble. */
  files?: File[];
  /** Safe metadata for files that were supplied only for the execution round. */
  attachments?: readonly ChatMessageAttachment[];
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
// A single transcript entry with a one-shot entrance. Pairs with
// InputMessage's onSend: render one per sent/received message. Position
// changes are owned by the transcript scroller — layout animation here
// fights that scroll and flashes the whole column.
const ChatMessage = forwardRef<HTMLDivElement, ChatMessageProps>(
  (
    {
      from,
      files,
      attachments,
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
    const intl = useIntl();
    const shape = useShape();
		const FileIcon = useIcon("file-code");
		const ImageIcon = useIcon("image");
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
        aria-label={intl.formatMessage(isUser ? desktopMessages.messageYour : desktopMessages.messageAssistant)}
        initial={shouldAnimate ? { opacity: 0, y: 8 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={shouldAnimate ? spring.moderate : { duration: 0 }}
        className={cn(
          "group flex flex-col gap-1.5",
          isUser ? "max-w-[80%] items-end self-end" : "w-full min-w-0 items-start self-start",
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
        {attachments && attachments.length > 0 && (
          <div
            className={cn(
              "flex flex-wrap gap-1.5",
              isUser ? "justify-end" : "justify-start"
            )}
          >
            {attachments.map((attachment) => {
              const AttachmentIcon = attachment.mimeType.startsWith("image/") ? ImageIcon : FileIcon;
              const attachmentLabel = `${attachment.filename} · ${formatAttachmentSize(attachment.size)}`;
              return (
                <span
                  key={attachment.id}
                  className="inline-flex max-w-72 items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-[12px] text-foreground shadow-surface-1"
                  title={attachmentLabel}
                >
                  <AttachmentIcon size={13} strokeWidth={1.6} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{attachment.filename}</span>
                  <span className="shrink-0 text-muted-foreground">{formatAttachmentSize(attachment.size)}</span>
                </span>
              );
            })}
          </div>
        )}
        {children != null && children !== "" && (
          <div
            className={cn(
              "min-w-0 text-[14px] wrap-break-word",
              !isUser && "w-full",
              // User keeps the bubble chrome (rounded fill + horizontal padding);
              // the assistant reply is flush-left plain text with no background.
              isUser
                ? cn(
                    shape.bg,
                    "no-squircle rounded-xl px-3 py-2 text-pretty leading-5 whitespace-pre-wrap bg-secondary text-foreground/85"
                  )
                : "text-foreground/95 leading-relaxed"
            )}
          >
            {!isUser && typeof children === "string" ? (
							<MarkdownContent content={children} isStreaming={isStreaming} />
            ) : (
              children
            )}
          </div>
        )}
        {!isUser ? (
          <span className="sr-only" role="status">
            {intl.formatMessage(isStreaming ? desktopMessages.messageResponding : desktopMessages.messageComplete)}
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

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

ChatMessage.displayName = "ChatMessage";

export { ChatMessage };
export type { ChatMessageProps };
export default ChatMessage;
