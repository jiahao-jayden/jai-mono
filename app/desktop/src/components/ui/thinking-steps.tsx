"use client";

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useContext,
  createContext,
  forwardRef,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import { motion } from "framer-motion";
import { Collapsible } from "@base-ui/react/collapsible";

// SSR-safe layout effect (client components still server-render in Next).
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;
import { cn } from "@/lib/utils";
import { useIcon } from "@/lib/icon-context";
import type { IconName } from "@/lib/icon-context";
import { spring } from "@/lib/springs";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { Badge } from "@/components/ui/badge";
import type { BadgeColor } from "@/components/ui/badge";

// ─── Shared collapsible parts ───────────────────────────────────────────────
//
// ThinkingSteps is built directly on Base UI's Collapsible with the
// library's framer-motion springs layered on top.

/** Open state of the nearest ThinkingSteps root, for the header trigger/panel. */
const ThinkingStepsOpenContext = createContext(false);

interface TriggerRowProps extends HTMLAttributes<HTMLButtonElement> {
  open: boolean;
  children: ReactNode;
}

/**
 * Trigger row: hover background, stable-weight label, and a
 * chevron that rotates from right (closed) to down (open). Mirrors the
 * library's accordion trigger styling.
 */
const TriggerRow = forwardRef<HTMLButtonElement, TriggerRowProps>(
  ({ open, children, className, ...props }, ref) => {
    const ChevronRight = useIcon("chevron-right");
    const shape = useShape();

    return (
      <div className="relative w-fit">
        <Collapsible.Trigger
          ref={ref}
          className={cn(
            "group relative z-10 flex cursor-pointer select-none items-center gap-1.5 px-1 py-1.5 outline-none",
            shape.item,
            "text-muted-foreground transition-colors duration-80 hover:bg-hover hover:text-foreground",
            "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] focus-visible:ring-offset-0",
            className
          )}
          {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        >
          <span
            className="text-left text-[12.5px]"
            style={{ fontVariationSettings: fontWeights.medium }}
          >
            {children}
          </span>

          <motion.span
            className="shrink-0 inline-flex items-center justify-center"
            animate={{ rotate: open ? 90 : 0 }}
            transition={spring.fast}
          >
            <ChevronRight
              size={13}
              strokeWidth={1.5}
              className="opacity-70 transition-opacity duration-80 group-hover:opacity-100"
            />
          </motion.span>
        </Collapsible.Trigger>
      </div>
    );
  }
);
TriggerRow.displayName = "ThinkingStepsTriggerRow";

interface CollapsePanelProps {
  open: boolean;
  children: ReactNode;
}

/**
 * Collapsible panel with a framer-motion height + spring animation.
 *
 * Base UI's Panel would apply `hidden` the moment a controlled collapsible
 * closes (it can't observe the JS-driven exit animation), which is
 * `display: none` and would freeze the exit mid-flight. So we render through
 * `keepMounted` + `render`, strip Base UI's premature `hidden`, and only
 * apply the attribute ourselves once the framer exit has actually completed.
 * The persistent panel element keeps the trigger ↔ panel ARIA contract
 * intact (the trigger's `aria-controls` id lives on it).
 */
function CollapsePanel({ open, children }: CollapsePanelProps) {
  // The open height is animated to a self-measured LAYOUT pixel value, not
  // `height: "auto"`: framer resolves an "auto" target by measuring the
  // element's *visual* (transformed) size, so under a scaled ancestor
  // (e.g. /demo's 1.7x card) the animation overshoots to scale× the real
  // height and snaps back when the final "auto" lands. offsetHeight and
  // ResizeObserver are transform-immune. Same setup as the accordions.
  const innerRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  // Panels open at mount render `initial: "auto"` and receive their first
  // pixel target a commit later; that hand-off must SNAP (duration 0), not
  // spring. Panels that open later spring normally.
  const needsSnap = useRef(open);

  const measureRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    innerRef.current = el;
    if (!el) return;
    if (el.offsetHeight > 0) setContentHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => {
      // Ignore the 0 that fires while the panel is display:none.
      if (el.offsetHeight > 0) setContentHeight(el.offsetHeight);
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);

  // Re-measure synchronously (pre-paint) when opening, so the spring's
  // target is the fresh layout height from its first frame.
  useIsoLayoutEffect(() => {
    if (open && innerRef.current && innerRef.current.offsetHeight > 0) {
      setContentHeight(innerRef.current.offsetHeight);
    }
  }, [open]);

  useEffect(() => {
    if (contentHeight !== null) needsSnap.current = false;
  }, [contentHeight]);

  const [exitComplete, setExitComplete] = useState(!open);
  if (open && exitComplete) {
    // Reset during render so the panel is un-hidden before the opening
    // animation's first paint.
    setExitComplete(false);
  }

  return (
    <Collapsible.Panel
      keepMounted
      render={(panelProps) => {
        const {
          // Applied too early for our exit animation (see above); we
          // control the attribute ourselves.
          hidden: _baseHidden,
          // Only carries the --collapsible-panel-height/width vars, which
          // stay 'auto' since Base UI never measures JS-driven animations.
          style: _baseStyle,
          ...restPanel
        } = panelProps as React.HTMLAttributes<HTMLDivElement> & {
          hidden?: boolean;
        };
        return (
          <div {...restPanel} hidden={!open && exitComplete}>
            <motion.div
              className="overflow-hidden"
              initial={{ height: open ? "auto" : 0 }}
              animate={{ height: open ? contentHeight ?? 0 : 0 }}
              // bounce: 0 — pure height looks better without overshoot.
              transition={
                needsSnap.current
                  ? { duration: 0 }
                  : { ...spring.moderate, bounce: 0 }
              }
              onAnimationComplete={() => {
                if (!open) setExitComplete(true);
              }}
            >
              <div
                ref={measureRef}
                className="px-1 pb-2 pt-1 text-[13px] text-muted-foreground"
              >
                {children}
              </div>
            </motion.div>
          </div>
        );
      }}
    />
  );
}

// ─── ThinkingSteps (root) ───────────────────────────────────────────────────

interface ThinkingStepsProps extends HTMLAttributes<HTMLDivElement> {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

const ThinkingSteps = forwardRef<HTMLDivElement, ThinkingStepsProps>(
  ({ defaultOpen = true, open, onOpenChange, children, className, ...props }, ref) => {
    // Always drive Base UI as controlled so the header/panel can read the
    // open state (chevron rotation, framer enter/exit) from context.
    const [internalOpen, setInternalOpen] = useState(defaultOpen);
    const isOpen = open ?? internalOpen;

    return (
      <Collapsible.Root
        ref={ref}
        open={isOpen}
        onOpenChange={(next: boolean) => {
          if (open === undefined) setInternalOpen(next);
          onOpenChange?.(next);
        }}
        className={cn("w-80 max-w-full", className)}
        {...props}
      >
        <ThinkingStepsOpenContext.Provider value={isOpen}>
          {children}
        </ThinkingStepsOpenContext.Provider>
      </Collapsible.Root>
    );
  }
);
ThinkingSteps.displayName = "ThinkingSteps";

// ─── ThinkingStepsHeader ────────────────────────────────────────────────────

interface ThinkingStepsHeaderProps extends HTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
}

const ThinkingStepsHeader = forwardRef<
  HTMLButtonElement,
  ThinkingStepsHeaderProps
>(({ children = "Thinking", className, ...props }, ref) => {
  const isOpen = useContext(ThinkingStepsOpenContext);
  return (
    <TriggerRow ref={ref} open={isOpen} className={className} {...props}>
      {children}
    </TriggerRow>
  );
});
ThinkingStepsHeader.displayName = "ThinkingStepsHeader";

// ─── ThinkingStepsContent ───────────────────────────────────────────────────

interface ThinkingStepsContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

const ThinkingStepsContent = forwardRef<
  HTMLDivElement,
  ThinkingStepsContentProps
>(({ children, className, ...props }, ref) => {
  const isOpen = useContext(ThinkingStepsOpenContext);
  return (
    <CollapsePanel open={isOpen}>
      <div
        ref={ref}
        className={cn("flex flex-col", className)}
        {...props}
      >
        {children}
      </div>
    </CollapsePanel>
  );
});
ThinkingStepsContent.displayName = "ThinkingStepsContent";

// ─── ThinkingStep ───────────────────────────────────────────────────────────

type StepStatus = "complete" | "active" | "pending";

interface ThinkingStepProps {
  icon?: IconName;
  showIcon?: boolean;
  label: string;
  description?: string;
  status?: StepStatus;
  children?: ReactNode;
  className?: string;
}

function ThinkingStep({
  icon = "dot",
  showIcon = true,
  label,
  description,
  status = "complete",
  children,
  className,
}: ThinkingStepProps) {
    const Icon = useIcon(icon);
    const ChevronRight = useIcon("chevron-right");
    const shape = useShape();
    const isActive = status === "active";
    const expandable = Boolean(children);
    const [open, setOpen] = useState(isActive);

    useEffect(() => {
      if (!isActive) setOpen(false);
    }, [isActive]);

    if (status === "pending") return null;

    const row = (
      <>
        <div className="flex w-3.25 shrink-0 items-start justify-center pt-px">
          {showIcon ? (
            <Icon size={13} strokeWidth={1.5} className="text-muted-foreground/75" />
          ) : (
            <div className="flex size-3.25 items-center justify-center">
              <div className="size-1 rounded-full bg-muted-foreground/50" />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className={cn(
              "text-[12.5px] leading-tight",
              isActive ? "shimmer-text text-foreground" : "text-foreground/80"
            )}
            style={{ fontVariationSettings: fontWeights.medium }}
          >
            {label}
            {isActive && "…"}
          </span>
          {description && (
            <span className="text-[12px] leading-snug text-muted-foreground">
              {description}
            </span>
          )}
        </div>
        {expandable && (
          <span
            className={cn(
              "ml-auto mt-px inline-flex size-3.25 shrink-0 items-center justify-center text-muted-foreground/70 transition-transform duration-150 motion-reduce:transition-none",
              open && "rotate-90"
            )}
          >
            <ChevronRight size={13} strokeWidth={1.5} />
          </span>
        )}
      </>
    );

    return (
      <div className={cn("relative z-10 min-w-0 w-full", className)}>
        {expandable ? (
          <Collapsible.Root open={open} onOpenChange={setOpen} className="min-w-0 w-full">
            <Collapsible.Trigger
              className={cn(
                "flex min-w-0 w-full gap-2 px-1 py-0.5 text-left outline-none transition-colors duration-80 hover:bg-hover",
                "focus-visible:ring-1 focus-visible:ring-(--focus-ring,#6B97FF)",
                shape.item
              )}
            >
              {row}
            </Collapsible.Trigger>
            <Collapsible.Panel className="min-w-0 w-full pl-6 pr-1">
              {children}
            </Collapsible.Panel>
          </Collapsible.Root>
        ) : (
          <div className={cn("flex gap-2 px-1 py-0.5", shape.item)}>{row}</div>
        )}
      </div>
    );
}

// ─── ThinkingStepSources ────────────────────────────────────────────────────

interface ThinkingStepSourcesProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

const ThinkingStepSources = forwardRef<HTMLDivElement, ThinkingStepSourcesProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("flex flex-wrap gap-1.5 mt-1", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);
ThinkingStepSources.displayName = "ThinkingStepSources";

// ─── ThinkingStepSource ─────────────────────────────────────────────────────

interface ThinkingStepSourceProps {
  color?: BadgeColor;
  delay?: number;
  children: ReactNode;
  className?: string;
}

function ThinkingStepSource({ color = "gray", delay = 0, children, className }: ThinkingStepSourceProps) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.85, filter: "blur(4px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      transition={{
        ...spring.moderate,
        delay,
        filter: { duration: 0.12, delay },
      }}
    >
      <Badge variant="solid" size="sm" color={color} className={className}>
        {children}
      </Badge>
    </motion.span>
  );
}
ThinkingStepSource.displayName = "ThinkingStepSource";

// ─── ThinkingStepImage ──────────────────────────────────────────────────────

interface ThinkingStepImageProps {
  src: string;
  alt?: string;
  caption?: string;
  delay?: number;
  className?: string;
}

function ThinkingStepImage({ src, alt = "", caption, delay = 0, className }: ThinkingStepImageProps) {
  const shape = useShape();
  return (
    <motion.div
      className={cn("mt-1.5", className)}
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{
        opacity: { duration: 0.2, delay, ease: "easeOut" },
        filter: { duration: 0.15, delay },
      }}
    >
      <img
        src={src}
        alt={alt}
        className={cn(
          "w-full max-w-[200px] object-cover",
          shape.container
        )}
      />
      {caption && (
        <span className="text-[11px] text-muted-foreground mt-1 block">
          {caption}
        </span>
      )}
    </motion.div>
  );
}
ThinkingStepImage.displayName = "ThinkingStepImage";

// ─── Exports ────────────────────────────────────────────────────────────────

export {
  ThinkingSteps,
  ThinkingStepsHeader,
  ThinkingStepsContent,
  ThinkingStep,
  ThinkingStepSources,
  ThinkingStepSource,
  ThinkingStepImage,
};

export type {
  ThinkingStepsProps,
  ThinkingStepsHeaderProps,
  ThinkingStepsContentProps,
  ThinkingStepProps,
  ThinkingStepSourcesProps,
  ThinkingStepSourceProps,
  ThinkingStepImageProps,
  StepStatus,
};
