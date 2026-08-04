"use client";

import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import type { IconComponent } from "@/lib/icon-context";
import { cn } from "@/lib/utils";
import { useShape } from "@/lib/shape-context";

const buttonVariants = cva(
  [
    "group relative isolate inline-flex items-center justify-center outline-none cursor-pointer",
    "transition-colors duration-80",
    "disabled:pointer-events-none",
  ],
  {
    variants: {
      variant: {
        primary: "text-background disabled:opacity-50",
        secondary: "text-foreground disabled:opacity-50",
        tertiary: "text-foreground disabled:opacity-50",
        ghost: "text-muted-foreground hover:text-foreground disabled:opacity-50",
        navigation: "text-foreground/75 hover:text-foreground",
      },
      size: {
        sm: "h-7 px-3 text-[12px] gap-1",
        md: "h-8 px-4 text-[13px] gap-1.5",
        lg: "h-9 px-5 text-[14px] gap-1.5",
        "icon-sm": "h-8 w-8 p-0 [&_svg]:h-3.5 [&_svg]:w-3.5",
        icon: "h-9 w-9 p-0 [&_svg]:h-4 [&_svg]:w-4",
        "icon-lg": "h-10 w-10 p-0 [&_svg]:h-5 [&_svg]:w-5",
      },
      iconLeft: { true: "" },
      iconRight: { true: "" },
    },
    compoundVariants: [
      { size: "sm", iconLeft: true, className: "pl-[6px]" },
      { size: "md", iconLeft: true, className: "pl-[10px]" },
      { size: "lg", iconLeft: true, className: "pl-[14px]" },
      { size: "sm", iconRight: true, className: "pr-[6px]" },
      { size: "md", iconRight: true, className: "pr-[10px]" },
      { size: "lg", iconRight: true, className: "pr-[14px]" },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** When true, the given single React-element child becomes the rendered element (slot-style). */
  asChild?: boolean;
  loading?: boolean;
  leadingIcon?: IconComponent;
  trailingIcon?: IconComponent;
  /** Force the visual selected/engaged state. Useful when the button drives an
   *  external open piece of UI (a popover, dropdown, etc.) so it reads as
   *  engaged while the menu is showing, or for navigation items that are
   *  currently active. */
  active?: boolean;
  /** Layout hooks for buttons whose label is structured content rather than text. */
  contentClassName?: string;
  labelClassName?: string;
}

const bgVariants: Record<string, string> = {
  primary: "bg-foreground group-hover:bg-foreground/90 group-active:bg-foreground/80",
  secondary: "bg-accent group-hover:bg-accent/80 group-active:bg-accent",
  tertiary: "border border-border bg-transparent group-hover:bg-hover group-active:bg-active",
  ghost: "bg-transparent group-hover:bg-hover group-active:bg-active",
  navigation: "bg-transparent group-hover:bg-sidebar-accent group-active:bg-sidebar-accent",
};

const activeBgVariants: Record<string, string> = {
  primary: "bg-foreground/80",
  secondary: "bg-accent",
  tertiary: "border border-border bg-active",
  ghost: "bg-active",
  navigation: "bg-sidebar-accent",
};

const disabledBgVariants: Record<string, string> = {
  primary: "bg-foreground",
  secondary: "bg-accent",
  tertiary: "border border-border bg-transparent",
  ghost: "bg-transparent",
  navigation: "bg-transparent",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      leadingIcon: LeadingIcon,
      trailingIcon: TrailingIcon,
      active = false,
      contentClassName,
      labelClassName,
      disabled,
      children,
      style,
      ...props
    },
    ref
  ) => {
    const asChildElement =
      asChild && isValidElement(children)
        ? (children as ReactElement<{
            children?: ReactNode;
            className?: string;
            style?: React.CSSProperties;
            ref?: React.Ref<HTMLButtonElement>;
          }>)
        : null;
    const label = asChildElement ? asChildElement.props.children : children;
    const isIconOnly = size === "icon" || size === "icon-sm" || size === "icon-lg";
    const iconSize = size === "sm" ? 14 : size === "lg" ? 20 : 16;
    const spinnerSizeClass =
      size === "sm"
        ? "h-7 w-7"
        : size === "lg" || size === "icon"
          ? "h-9 w-9"
          : size === "icon-lg"
            ? "h-10 w-10"
            : "h-8 w-8";
    const shape = useShape();
    const v = variant ?? "primary";
    const isDisabled = disabled || loading;

    // State priority: disabled > active/selected > hover > rest
    const bgClass = isDisabled
      ? disabledBgVariants[v]
      : active
        ? activeBgVariants[v]
        : bgVariants[v];

    const internals = (
      <>
        <span
          aria-hidden
          className={cn(
            "absolute inset-0 rounded-[inherit] transition-[background-color,transform] duration-80",
            !isDisabled && "group-active:scale-[0.98]",
            bgClass
          )}
        />
        <span className={cn("relative inline-flex items-center justify-center gap-[inherit]", contentClassName)}>
          {loading ? (
            <>
              <span className="flex items-center justify-center gap-[inherit] opacity-0">
                {LeadingIcon && !isIconOnly && (
                  <LeadingIcon size={iconSize} strokeWidth={1.5} />
                )}
                {label}
                {TrailingIcon && !isIconOnly && (
                  <TrailingIcon size={iconSize} strokeWidth={1.5} />
                )}
              </span>
              <span className="absolute inset-0 flex items-center justify-center">
                <svg
                  className={spinnerSizeClass}
                  viewBox="0 0 24 24"
                  fill="none"
                >
                  <path
                    d="M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z"
                    stroke="currentColor"
                    strokeWidth="1.125"
                    strokeLinecap="round"
                    pathLength="100"
                    style={{
                      strokeDasharray: "15 85",
                      animation: "spinner-move 2s linear infinite, spinner-dash 4s ease-in-out infinite",
                    }}
                  />
                </svg>
              </span>
            </>
          ) : isIconOnly ? (
            <span className="[&_svg]:stroke-[1.5]">
              {label}
            </span>
          ) : (
            <>
              {LeadingIcon && (
                <LeadingIcon size={iconSize} strokeWidth={1.5} />
              )}
              <span className={cn("[text-box:trim-both_cap_alphabetic]", labelClassName)}>{label}</span>
              {TrailingIcon && (
                <TrailingIcon size={iconSize} strokeWidth={1.5} />
              )}
            </>
          )}
        </span>
      </>
    );

    const rootClassName = cn(
      buttonVariants({
        variant,
        size,
        iconLeft: !isIconOnly && !!LeadingIcon,
        iconRight: !isIconOnly && !!TrailingIcon,
      }),
      shape.button,
      className
    );

    if (asChildElement) {
      const childProps = asChildElement.props;
      return cloneElement(
        asChildElement,
        {
          ...props,
          ref,
          className: cn(rootClassName, childProps.className),
          style: { ...style, ...childProps.style },
        },
        internals
      );
    }

    return (
      <ButtonPrimitive
        ref={ref as React.Ref<HTMLButtonElement>}
        className={rootClassName}
        disabled={isDisabled}
        style={style}
        {...props}
      >
        {internals}
      </ButtonPrimitive>
    );
  }
);

Button.displayName = "Button";

export { Button, buttonVariants };
export type { ButtonProps };
