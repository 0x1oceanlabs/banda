import type { ReactNode } from "react"
import { XIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "./button"

/**
 * A tile's header: one row as tall as every Pane's, with what the Pane puts
 * in it and its close button at the end. The frame draws it for most
 * Panes; a Pane that draws its own (`header: false`) draws it with this.
 */
function PaneHeader({
  title,
  onClose,
  className,
  children,
}: {
  /** What the close button closes, for its label. */
  title: string
  onClose: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <header
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 border-b px-2.5 text-sm",
        className
      )}
    >
      {children}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Close ${title}`}
        title="Close (Alt+W)"
        className="ml-auto shrink-0 opacity-0 transition-opacity group-hover/tile:opacity-100 group-data-[focused=true]/tile:opacity-100 focus-visible:opacity-100"
        onClick={onClose}
      >
        <XIcon />
      </Button>
    </header>
  )
}

export { PaneHeader }
