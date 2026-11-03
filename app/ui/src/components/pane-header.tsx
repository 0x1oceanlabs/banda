import type { ReactNode } from "react"
import { XIcon, type LucideIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "./button"

/**
 * A tile's header: one row as tall as every Pane's, with what the Pane puts
 * in it and its close button at the end. The frame draws it for most
 * Panes; a Pane that draws its own (`header: false`) draws it with this.
 * The mouse carries the Pane by it (`data-handle`).
 */
function PaneHeader({
  title,
  icon: Icon,
  onClose,
  className,
  actions,
  children,
}: {
  /** What the close button closes, for its label. */
  title: string
  /** The Pane's kind's icon, drawn first. */
  icon?: LucideIcon | undefined
  onClose: () => void
  className?: string
  /** Buttons of its own, beside the close button. */
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <header
      data-handle=""
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 border-b px-2.5 text-sm",
        className
      )}
    >
      {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
      {children}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {actions}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Close ${title}`}
          title="Close (Alt+W)"
          className="shrink-0 opacity-0 transition-opacity group-hover/tile:opacity-100 group-data-[focused=true]/tile:opacity-100 focus-visible:opacity-100"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
    </header>
  )
}

export { PaneHeader }
