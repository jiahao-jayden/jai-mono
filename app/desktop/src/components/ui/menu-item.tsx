"use client";

import {
  createContext,
  useContext,
  useRef,
  useEffect,
  forwardRef,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { type IconComponent, useIcons } from "@/lib/icon-context";
import { cn } from "cn";
import { fontWeights } from "@/lib/font-weight";
import { shapeMap } from "@/lib/shape-context";

// MenuItem is only used inside Dropdown, which opts out of the global pill
// shape — see dropdown.tsx for the rationale.
const shape = shapeMap.rounded;

// ---------------------------------------------------------------------------
// Dropdown context — the single shared context for every Dropdown build.
//
// It lives here rather than in the dropdown module so that (a) MenuItem stays
// primitive-free and self-contained, and (b) dropdowns built on different
// primitives (Radix, Base UI) can render side by side — each provides this
// same context object, so MenuItem resolves whichever provider actually
// wraps it. The dropdown module re-exports useDropdown from here, keeping
// its public API unchanged.
// ---------------------------------------------------------------------------

/** What MenuItem hands to the popup's primitive wrapper. `element` is the
 *  styled row div (visuals + proximity registration, no children); `children`
 *  is the row content (icon, label, check). The dropdown wraps them in its
 *  own Item / RadioItem primitive, so MenuItem itself stays primitive-free. */
export interface MenuItemRenderOptions {
  /** Radio-style option (boolean `checked` on MenuItem) vs plain action item. */
  radio: boolean;
  /** The item's index — doubles as the radio value. */
  value: number;
  disabled?: boolean;
  label: string;
  closeOnClick: boolean;
  submenu?: boolean;
  element: ReactElement;
  children: ReactNode;
}

export interface DropdownContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void;
  activeIndex: number | null;
  checkedIndex?: number;
  /** True when items render inside a Menu popup (DropdownContent), where the
   *  primitive's Item / RadioItem own roles, roving highlight, typeahead,
   *  and activation. MenuItem switches its rendering accordingly. */
  inMenu?: boolean;
  /** Popup-only: wraps a MenuItem's styled div in the dropdown's menu-item
   *  primitive. Absent in the inline Dropdown panel, where MenuItem renders
   *  its own ARIA menuitem div. */
  renderMenuItem?: (opts: MenuItemRenderOptions) => ReactElement;
  directHighlight?: boolean;
  /** Visual scale of items within this dropdown. `"sm"` shrinks icons, text,
   *  and row height for secondary-level submenus. @default "default" */
  size?: "default" | "sm";
}

export const DropdownContext = createContext<DropdownContextValue | null>(null);

export function useDropdown() {
  const ctx = useContext(DropdownContext);
  if (!ctx) throw new Error("useDropdown must be used within a Dropdown");
  return ctx;
}

/** Null-safe context read for callers that render outside a provider. */
export function useDropdownMaybe() {
  return useContext(DropdownContext);
}

interface MenuItemProps extends HTMLAttributes<HTMLDivElement> {
  /** Optional leading icon. When omitted, the row renders text-only with no
   *  reserved icon column. */
  icon?: IconComponent;
  leadingVisual?: ReactNode;
  trailingIcon?: IconComponent;
  label: string;
  description?: string;
  index: number;
  /** When a boolean, the item is a radio-style option (role="menuitemradio"
   *  with aria-checked). When undefined, it is a plain action item
   *  (role="menuitem", no checked state announced). */
  checked?: boolean;
  onSelect?: () => void;
  disabled?: boolean;
  variant?: "default" | "destructive";
  submenu?: boolean;
  /** Popup-only (inside DropdownContent): whether activating the item closes
   *  the menu. Ignored in the inline Dropdown panel. @default true */
  closeOnClick?: boolean;
}

const MenuItem = forwardRef<HTMLDivElement, MenuItemProps>(
  (
    {
      icon: Icon,
      leadingVisual,
      trailingIcon: TrailingIcon,
      label,
      description,
      index,
      checked,
      onSelect,
      disabled,
      variant = "default",
      submenu,
      closeOnClick,
      className,
      onClick,
      ...props
    },
    ref
  ) => {
    const internalRef = useRef<HTMLDivElement>(null);
    const icons = useIcons();
    const CheckIcon = icons.check;
    const { registerItem, activeIndex, checkedIndex, renderMenuItem, directHighlight, size = "default" } =
      useDropdown();

    useEffect(() => {
      registerItem(index, internalRef.current);
      return () => registerItem(index, null);
    }, [index, registerItem]);

    const isActive = activeIndex === index;
    const isSm = size === "sm";
    const iconSize = isSm ? 16 : 18;
    const trailingIconSize = isSm ? 14 : 16;
    const labelTextClass = isSm ? "text-[13.5px]" : "text-[14px]";
    const descriptionTextClass = isSm ? "text-[11px]" : "text-[12px]";
    const checkedWeight = fontWeights.normal;

    const mergeRef = (node: HTMLDivElement | null) => {
      (internalRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    };

    const handleActivate = disabled
      ? undefined
      : (e: React.MouseEvent<HTMLDivElement>) => {
          onClick?.(e);
          onSelect?.();
        };

    const itemClassName = cn(
      // Fixed height (was py-2 around a 19.5px line box ≈ 35.5px) so the
      // text-box trim on the label doesn't shrink the row. shrink-0 because
      // menu popups are max-height flex columns — without it a long list
      // compresses rows to fit instead of scrolling.
      `relative z-10 flex shrink-0 items-center gap-2.5 ${shape.item} px-2.5 cursor-pointer outline-none`,
      description
        ? cn(isSm ? "min-h-12 py-1.5" : "min-h-14 py-2")
        : cn(isSm ? "h-7" : "h-8"),
      disabled && "opacity-50 pointer-events-none",
      directHighlight && "data-[highlighted]:bg-muted-hover",
      className
    );

    const content = (
      <>
        {leadingVisual ?? (Icon && (
          <span className="inline-grid place-items-center">
            <span className="col-start-1 row-start-1 invisible">
              <Icon size={iconSize} strokeWidth={2} />
            </span>
            <Icon
              size={iconSize}
              strokeWidth={isActive || checked ? 2 : 1.5}
              className={cn(
                "col-start-1 row-start-1 transition-[color,stroke-width] duration-80",
                variant === "destructive"
                  ? "text-destructive"
                  : isActive || checked
                    ? "text-foreground"
                    : "text-muted-foreground"
              )}
            />
          </span>
        ))}
        {/* Keep the full line box. `text-box: trim-both cap alphabetic`
            clips CJK glyphs and makes menu labels look vertically crushed. */}
        <span className={cn("min-w-0 flex-1", labelTextClass)}>
          <span className="inline-grid max-w-full">
            <span
              className="col-start-1 row-start-1 invisible"
              style={{ fontVariationSettings: checkedWeight }}
              aria-hidden="true"
            >
              {label}
            </span>
            <span
              className={cn(
                "col-start-1 row-start-1 truncate transition-[font-variation-settings] duration-80",
                variant === "destructive"
                  ? "text-destructive"
                  : "text-foreground"
              )}
              style={{
                fontVariationSettings: checked
                  ? checkedWeight
                  : fontWeights.normal,
              }}
            >
              {label}
            </span>
          </span>
          {description ? (
            <span className={cn("mt-1 block truncate leading-none text-muted-foreground/70", descriptionTextClass)}>
              {description}
            </span>
          ) : null}
        </span>
        {TrailingIcon ? (
          <TrailingIcon
            size={trailingIconSize}
            strokeWidth={1.5}
            className="shrink-0 text-muted-foreground"
          />
        ) : null}
        {checked ? (
          <CheckIcon size={16} strokeWidth={2} className="shrink-0 text-foreground" />
        ) : null}
      </>
    );

    if (renderMenuItem) {
      // Inside DropdownContent, the menu-item primitive (supplied by the
      // surrounding DropdownContent through context) owns the role,
      // aria-checked, tabIndex, roving highlight, typeahead, and Enter/Space/
      // click activation (activation synthesizes a click, so handleActivate
      // also fires for keyboard). The styled div carries the Fluid
      // Functionalism visuals and the proximity-hover registration; MenuItem
      // itself imports no primitive.
      return renderMenuItem({
        radio: typeof checked === "boolean",
        value: index,
        disabled,
        label,
        closeOnClick: closeOnClick ?? true,
        submenu,
        element: (
          <div
            ref={mergeRef}
            data-proximity-index={index}
            aria-label={label}
            onClick={handleActivate}
            className={itemClassName}
            {...props}
          />
        ),
        children: content,
      });
    }

    return (
      <div
        ref={mergeRef}
        data-proximity-index={index}
        // Disabled items are never the roving tab stop.
        tabIndex={!disabled && index === (checkedIndex ?? 0) ? 0 : -1}
        role={typeof checked === "boolean" ? "menuitemradio" : "menuitem"}
        aria-checked={typeof checked === "boolean" ? checked : undefined}
        aria-disabled={disabled || undefined}
        aria-label={label}
        onClick={handleActivate}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onSelect?.();
          }
        }}
        className={itemClassName}
        {...props}
      >
        {content}
      </div>
    );
  }
);

MenuItem.displayName = "MenuItem";

export { MenuItem };
export default MenuItem;
