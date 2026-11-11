/** What went wrong in a git row, as the card, the picker and the Diff
 * say it: in red, or `quiet` for what is no one's error; with a button
 * that puts it away when `onDismiss` can, and `action`, what the Person
 * can do about it, before that. */
import type { ReactNode } from "react"
import { Button } from "@banda/ui/components/button"
import { cn } from "@banda/ui/lib/utils"
import { CircleAlertIcon, XIcon } from "lucide-react"

export function GitAlert({
  children,
  quiet = false,
  onDismiss,
  action,
  className,
}: {
  children: ReactNode
  quiet?: boolean
  onDismiss?: () => void
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 text-xs",
        quiet ? "text-muted-foreground" : "text-destructive",
        className
      )}
    >
      <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 py-0.5 break-words">{children}</span>
      {action}
      {onDismiss && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <XIcon />
        </Button>
      )}
    </div>
  )
}
