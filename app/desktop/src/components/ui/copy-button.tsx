import * as React from "react"
import { useIntl } from "react-intl"
import { Button, type ButtonProps } from "@/components/ui/button"
import { desktopMessages } from "@/i18n/messages"
import { useIcons } from "@/lib/icon-context"

type CopyButtonProps = Omit<ButtonProps, "children" | "onClick" | "leadingIcon"> & {
  text: string
  /** Idle label; switches to Copied / Copy failed for two seconds after a click. */
  label?: string
}

function CopyButton({ text, label, variant = "ghost", size = "sm", ...props }: CopyButtonProps) {
  const intl = useIntl()
  const icons = useIcons()
  const [status, setStatus] = React.useState<"idle" | "copied" | "failed">("idle")

  React.useEffect(() => {
    if (status === "idle") return
    const timer = window.setTimeout(() => setStatus("idle"), 2000)
    return () => window.clearTimeout(timer)
  }, [status])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setStatus("copied")
    } catch {
      setStatus("failed")
    }
  }
  const currentLabel =
    status === "copied"
      ? intl.formatMessage(desktopMessages.commonCopied)
      : status === "failed"
        ? intl.formatMessage(desktopMessages.commonCopyFailed)
        : (label ?? intl.formatMessage(desktopMessages.commonCopy))

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      leadingIcon={status === "copied" ? icons.check : icons.copy}
      aria-live="polite"
      onClick={() => void copy()}
      {...props}
    >
      {currentLabel}
    </Button>
  )
}

export { CopyButton }
