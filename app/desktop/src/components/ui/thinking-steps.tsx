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
import { Badge } from "@/components/ui/badge";
import type { BadgeColor } from "@/components/ui/badge";

// ─── Shared collapsible parts ───────────────────────────────────────────────
//
// ThinkingSteps is built directly on Base UI's Collapsible with a
// measured-height animation layered on top (transform-immune, same setup as
// the accordions).

/** Open state of the nearest ThinkingSteps root, for the header trigger/panel. */
const ThinkingStepsOpenContext = createContext(false);

// Aside ease-out curve for panel height/opacity (200ms).
const PANEL_EASE: [number, number, number, number] = [0, 0, 0.2, 1];
const PANEL_DURATION = 0.2;

interface TriggerRowProps extends HTMLAttributes<HTMLButtonElement> {
  open: boolean;
  children: ReactNode;
}

/**
 * Header trigger row: a plain min-h-6 label in muted-foreground that lifts to
 * foreground on hover, with a chevron that only appears on hover and rotates
 * 90° when open. Mirrors the `.step-trigger` grammar.
 */
const TriggerRow = forwardRef<HTMLButtonElement, TriggerRowProps>(
  ({ open, children, className, ...props }, ref) => {
    const ChevronRight = useIcon("chevron-right");

    return (
      <div className="relative w-fit">
        <Collapsible.Trigger
          ref={ref}
          className={cn(
            "group relative z-10 flex cursor-pointer select-none items-center gap-1 min-h-6 px-1 py-0.5 outline-none",
            "text-muted-foreground font-normal text-[14px] leading-5 transition-colors duration-150 hover:text-foreground",
            "focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0",
            className
          )}
          {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        >
          <span className="block min-w-0 max-w-full truncate text-left">
            {children}
          </span>

          <motion.span
            className="shrink-0 inline-flex items-center justify-center text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            animate={{ rotate: open ? 90 : 0 }}
            transition={{ duration: PANEL_DURATION, ease: PANEL_EASE }}
          >
            <ChevronRight size={14} strokeWidth={1.5} />
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
  innerClassName?: string;
}

/**
 * Collapsible panel with a measured-height animation (transform-immune) plus an
 * inner opacity + padding-top transition, matching Aside's `.step-panel` /
 * `.step-panel-inner` pair.
 *
 * Base UI's Panel would apply `hidden` the moment a controlled collapsible
 * closes (it can't observe the JS-driven exit animation), which is
 * `display: none` and would freeze the exit mid-flight. So we render through
 * `keepMounted` + `render`, strip Base UI's premature `hidden`, and only
 * apply the attribute ourselves once the framer exit has actually completed.
 */
function CollapsePanel({ open, children, innerClassName }: CollapsePanelProps) {
  // The open height is animated to a self-measured LAYOUT pixel value, not
  // `height: "auto"`: framer resolves an "auto" target by measuring the
  // element's *visual* (transformed) size, so under a scaled ancestor
  // (e.g. /demo's 1.7x card) the animation overshoots to scale× the real
  // height and snaps back when the final "auto" lands. offsetHeight and
  // ResizeObserver are transform-immune.
  const innerRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  // Panels open at mount render `initial: "auto"` and receive their first
  // pixel target a commit later; that hand-off must SNAP (duration 0), not
  // animate. Panels that open later animate normally.
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

  // Re-measure synchronously (pre-paint) when opening, so the animation's
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
              transition={
                needsSnap.current
                  ? { duration: 0 }
                  : { duration: PANEL_DURATION, ease: PANEL_EASE }
              }
              onAnimationComplete={() => {
                if (!open) setExitComplete(true);
              }}
            >
              <motion.div
                ref={measureRef}
                className={cn("px-1 pb-2 text-muted-foreground", innerClassName)}
                initial={false}
                animate={{
                  opacity: open ? 1 : 0,
                  paddingTop: open ? 12 : 4,
                }}
                transition={{ duration: PANEL_DURATION, ease: PANEL_EASE }}
              >
                {children}
              </motion.div>
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
        className={cn("flex flex-col -mx-1 pb-2", className)}
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
  /** When true, the rail's connector line is hidden unless this step is open.
   *  Pass `true` on the last step so the line doesn't dangle into nothing. */
  isLast?: boolean;
  children?: ReactNode;
  className?: string;
}

function ThinkingStep({
  icon = "dot",
  showIcon = true,
  label,
  description,
  status = "complete",
  isLast = false,
  children,
  className,
}: ThinkingStepProps) {
    const Icon = useIcon(icon);
    const ChevronRight = useIcon("chevron-right");
    const isActive = status === "active";
    const expandable = Boolean(children);
    const [open, setOpen] = useState(isActive);
    const showLine = !isLast || open;

    useEffect(() => {
      if (!isActive) setOpen(false);
    }, [isActive]);

    if (status === "pending") return null;

    const node = (
      <div className="relative z-1 flex size-6 items-center justify-center text-muted-foreground">
        {showIcon ? (
          <Icon size={16} strokeWidth={1.5} />
        ) : (
          <div className="size-1.5 rounded-full bg-muted-foreground/35" />
        )}
      </div>
    );

    const labelRow = (
      <div className="flex items-center gap-1">
        <span
          className={cn(
            "block min-w-0 flex-1 truncate text-[14px] leading-5",
            isActive ? "shimmer-text" : "text-muted-foreground"
          )}
        >
          {label}
          {isActive && "…"}
        </span>
        {description && (
          <span className="text-[14px] leading-5 text-muted-foreground">
            {description}
          </span>
        )}
        {expandable && (
          <motion.span
            className="shrink-0 inline-flex items-center justify-center text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            animate={{ rotate: open ? 90 : 0 }}
            transition={{ duration: PANEL_DURATION, ease: PANEL_EASE }}
          >
            <ChevronRight size={14} strokeWidth={1.5} />
          </motion.span>
        )}
      </div>
    );

    return (
      <div
        className={cn(
          "relative flex items-start gap-1.5 text-[14px] leading-5 pb-2",
          className
        )}
      >
        <div className="relative flex w-6 min-h-6 shrink-0 items-start justify-center self-stretch">
          {showLine && (
            <div className="absolute top-6 left-1/2 w-px bg-border h-[calc(100%-16px)] min-h-2 -translate-x-1/2" />
          )}
          {node}
        </div>
        {expandable ? (
          <Collapsible.Root
            open={open}
            onOpenChange={setOpen}
            className="group flex min-w-0 flex-1 flex-col"
          >
            <Collapsible.Trigger
              className={cn(
                "flex min-w-0 items-start gap-1 px-1 py-0.5 text-left outline-none",
                "text-muted-foreground transition-colors duration-150 hover:text-foreground",
                "focus-visible:ring-1 focus-visible:ring-ring"
              )}
            >
              {labelRow}
            </Collapsible.Trigger>
            <CollapsePanel open={open}>
              <div className="text-[14px]">{children}</div>
            </CollapsePanel>
          </Collapsible.Root>
        ) : (
          <div className="group flex min-w-0 flex-1 items-start px-1 py-0.5">
            {labelRow}
          </div>
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
        type: "spring",
        stiffness: 300,
        damping: 26,
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
        className="w-full max-w-[200px] rounded-xl no-squircle object-cover"
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
