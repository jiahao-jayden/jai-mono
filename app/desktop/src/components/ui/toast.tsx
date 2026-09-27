import * as React from "react"
import { Toast as ToastPrimitive, type ToastObject } from "@base-ui/react/toast"
import { useIntl } from "react-intl"
import { desktopMessages } from "@/i18n/messages"

import { cn } from "cn"
import { Button, type ButtonProps } from "@/components/ui/button"
import { CopyButton } from "@/components/ui/copy-button"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, CheckmarkCircle02Icon, InformationCircleIcon, Alert02Icon, MultiplicationSignCircleIcon, Loading03Icon } from "@hugeicons/core-free-icons"

type ToastData = {
  /** Shows a Copy action that writes this text to the clipboard. */
  copyText?: string
  /** Rendered as a second button after the primary `actionProps` action. */
  secondaryActionProps?: ButtonProps
}

type ToastItem = ToastObject<ToastData>

const toast = ToastPrimitive.createToastManager<ToastData>()

const toastIcons = {
  success: { icon: CheckmarkCircle02Icon, className: "text-success" },
  info: { icon: InformationCircleIcon, className: undefined },
  warning: { icon: Alert02Icon, className: undefined },
  error: { icon: MultiplicationSignCircleIcon, className: "text-destructive" },
  loading: { icon: Loading03Icon, className: "animate-spin" },
} as const

function ToastIcon({ type }: { type: string | undefined }) {
  const entry = toastIcons[type as keyof typeof toastIcons]
  if (!entry) return null
  return (
    <span data-slot="toast-icon" className="flex h-lh shrink-0 items-center [&_svg]:pointer-events-none [&_svg]:size-4">
      <HugeiconsIcon icon={entry.icon} strokeWidth={2} className={entry.className} aria-hidden="true" />
    </span>
  )
}

function ToastClose({ compact }: { compact: boolean }) {
  const intl = useIntl()
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label={intl.formatMessage(desktopMessages.commonClose)}
      render={<Button variant="ghost" size="icon-xs" />}
      className={cn("shrink-0 text-muted-foreground hover:text-foreground", !compact && "absolute top-2 right-2")}
    >
      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} aria-hidden="true" />
    </ToastPrimitive.Close>
  )
}

function ToastCard({ item }: { item: ToastItem }) {
  const copyText = item.data?.copyText
  const secondaryActionProps = item.data?.secondaryActionProps
  const compact = !copyText && !item.actionProps && !secondaryActionProps

  return (
    <ToastPrimitive.Root
      toast={item}
      swipeDirection="up"
      data-slot="toast"
      data-compact={compact || undefined}
      className={cn(
        "pointer-events-auto absolute inset-x-0 top-0 z-[calc(1000-var(--toast-index))] mx-auto select-none text-popover-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "border border-border bg-popover/94 shadow-lg/10 backdrop-blur-xl [-webkit-app-region:no-drag] dark:shadow-lg/15",
        compact ? "w-max max-w-full rounded-xl" : "w-full rounded-2xl",
        item.type === "error" &&
          "border-[color-mix(in_srgb,var(--destructive)_16%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_5%,var(--popover))] dark:border-[color-mix(in_srgb,var(--destructive)_13%,transparent)] dark:bg-[color-mix(in_srgb,var(--destructive)_8%,var(--popover))]",
        "[--toast-gap:--spacing(3)] [--toast-calc-height:max(var(--toast-frontmost-height,var(--toast-height)),var(--toast-height))]",
        "h-(--toast-calc-height) [transform:translateY(var(--toast-swipe-movement-y))] [transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]",
        "after:absolute after:top-full after:left-0 after:h-[calc(var(--toast-gap)+1px)] after:w-full after:content-['']",
        "data-expanded:h-(--toast-height) data-expanded:[transform:translateY(calc(var(--toast-offset-y)+var(--toast-index)*var(--toast-gap)+var(--toast-swipe-movement-y)))]",
        "data-starting-style:[transform:translateY(calc(-100%-var(--toast-inset)))]",
        "data-ending-style:[transform:translateY(calc(var(--toast-swipe-movement-y)-100%-var(--toast-inset)))]",
        "data-ending-style:pointer-events-none data-ending-style:opacity-0 data-limited:pointer-events-none data-limited:opacity-0",
      )}
    >
      <ToastPrimitive.Content
        data-slot="toast-content"
        className={cn(
          "pointer-events-auto relative flex h-full overflow-hidden text-[13px] leading-normal transition-opacity duration-250 data-behind:pointer-events-none data-behind:opacity-0 data-expanded:pointer-events-auto data-expanded:opacity-100",
          compact ? "items-center gap-2 py-1.5 pr-1.5 pl-3" : "items-start gap-2 py-3 pr-10 pl-3.5",
        )}
      >
        <ToastIcon type={item.type} />
        <div className={cn("min-w-0 flex-1", !compact && "flex flex-col gap-0.5")}>
          <ToastPrimitive.Title data-slot="toast-title" className={cn("font-medium", compact ? "truncate" : "break-words")} />
          {!compact && <ToastPrimitive.Description data-slot="toast-description" className="break-words text-muted-foreground" />}
          {!compact && (
            <div className="mt-1.5 -ms-2 flex flex-wrap items-center gap-0.5">
              {copyText && <CopyButton text={copyText} />}
              <ToastPrimitive.Action data-slot="toast-action" render={<Button variant="ghost" size="sm" />} />
              {secondaryActionProps && <Button variant="ghost" size="sm" {...secondaryActionProps} />}
            </div>
          )}
        </div>
        <ToastClose compact={compact} />
      </ToastPrimitive.Content>
    </ToastPrimitive.Root>
  )
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager<ToastData>()
  const hasToasts = toasts.length > 0

  // Base UI only listens for window blur while toasts are mounted, so a toast added while the
  // window is already unfocused would keep counting down. Replay the blur once its listener exists.
  React.useEffect(() => {
    if (!hasToasts) return
    const timer = window.setTimeout(() => {
      if (!document.hasFocus()) window.dispatchEvent(new Event("blur"))
    })
    return () => window.clearTimeout(timer)
  }, [hasToasts])

  return toasts.map((item) => <ToastCard key={item.id} item={item} />)
}

function Toaster({ children, toastManager = toast, timeout = 10_000, ...props }: ToastPrimitive.Provider.Props) {
  return (
    <ToastPrimitive.Provider toastManager={toastManager} timeout={timeout} {...props}>
      {children}
      <ToastPrimitive.Portal data-slot="toast-portal">
        {/* Electron recomputes drag regions only on layout, not after the cards' transform transitions,
            so the untransformed viewport also opts out of the title bar drag region. */}
        <ToastPrimitive.Viewport
          data-slot="toast-viewport"
          className="pointer-events-none fixed top-4 left-1/2 z-[200] h-(--toast-frontmost-height) w-[calc(100%-var(--toast-inset)*2)] max-w-sm -translate-x-1/2 outline-none [--toast-inset:--spacing(4)] [-webkit-app-region:no-drag]"
        >
          <ToastList />
        </ToastPrimitive.Viewport>
      </ToastPrimitive.Portal>
    </ToastPrimitive.Provider>
  )
}

export { Toaster, ToastList, toast }
export type { ToastData }
