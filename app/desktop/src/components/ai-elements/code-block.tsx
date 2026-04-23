import { isValidElement, type HTMLAttributes } from "react";
import { CodeBlock, CodeBlockCopyButton, CodeBlockDownloadButton } from "streamdown";
import { cn } from "@/lib/utils";

interface CustomCodeProps extends HTMLAttributes<HTMLElement> {
	node?: unknown;
	"data-block"?: string;
}

export function CustomCode({ node, className, children, ...props }: CustomCodeProps) {
	const isBlock = "data-block" in props;

	if (!isBlock) {
		return (
			<code
				className={cn(
					"rounded-[5px] bg-foreground/6 px-1.25 py-px font-mono text-[0.875em] text-foreground/90",
					className,
				)}
				data-streamdown="inline-code"
				{...props}
			>
				{children}
			</code>
		);
	}

	const lang = className?.match(/language-(\w+)/)?.[1] || "";
	let code = "";
	if (typeof children === "string") {
		code = children;
	} else if (isValidElement(children) && typeof (children.props as Record<string, unknown>)?.children === "string") {
		code = (children.props as Record<string, unknown>).children as string;
	}

	return (
		<div className="group/code my-2 flex w-full flex-col rounded-lg border border-border bg-sidebar text-[0.8125rem]">
			<div className="flex items-center justify-between px-3 pt-1.5 pb-0">
				<span className="font-mono text-[0.6875rem] lowercase text-muted-foreground/50">{lang}</span>
				<div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover/code:opacity-100">
					<CodeBlockDownloadButton
						code={code}
						language={lang}
						className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-accent transition-colors"
					/>
					<CodeBlockCopyButton
						code={code}
						className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground/40 hover:text-foreground hover:bg-accent transition-colors"
					/>
				</div>
			</div>
			<div className="compact-code-block">
				<CodeBlock code={code} language={lang} />
			</div>
		</div>
	);
}
