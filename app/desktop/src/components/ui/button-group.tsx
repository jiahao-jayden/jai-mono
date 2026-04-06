import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type ButtonGroupProps = ComponentProps<"div"> & {
	orientation?: "horizontal" | "vertical";
};

export const ButtonGroup = ({ className, orientation = "horizontal", ...props }: ButtonGroupProps) => (
	<div
		className={cn(
			"inline-flex items-center rounded-md border border-input bg-background shadow-sm",
			orientation === "vertical" ? "flex-col" : "flex-row",
			"[&>*:not(:first-child)]:border-l [&>*:not(:first-child)]:rounded-l-none",
			"[&>*:not(:last-child)]:rounded-r-none",
			className,
		)}
		{...props}
	/>
);

export type ButtonGroupTextProps = ComponentProps<"span">;

export const ButtonGroupText = ({ className, ...props }: ButtonGroupTextProps) => (
	<span
		className={cn(
			"inline-flex items-center justify-center px-2 text-xs text-muted-foreground",
			className,
		)}
		{...props}
	/>
);
