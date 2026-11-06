/**
 * A quiet icon button a Files Pane puts in its header: brighter while it
 * is on, with no plate behind it (ADR 0066).
 */
import type { ReactNode } from "react"
import { Button } from "@banda/ui/components/button"
import { cn } from "@banda/ui/lib/utils"

export function HeaderButton({
  label,
  title = label,
  on,
  disabled = false,
  onClick,
  children,
}: {
  label: string
  /** Its tooltip, as with its key; its label unless said. */
  title?: string
  /** Whether it stays on; none for a button that only acts. */
  on?: boolean
  /** It does nothing now: its tooltip still says why. */
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      aria-pressed={on}
      title={title}
      disabled={disabled}
      focusableWhenDisabled
      className={cn(
        "shrink-0 data-disabled:opacity-40 data-disabled:hover:bg-transparent",
        on && "text-foreground"
      )}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}
