import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { XIcon, type LucideIcon } from "lucide-react"
import { cn } from "../lib/utils"
import { Button } from "./button"

/**
 * Buttons the window puts in every Pane's header, its own or the frame's,
 * as the one that pops it out into a window of its own (ADR 0025).
 */
const TileActions = createContext<ReactNode>(null)

/** Where a Pane's own buttons go in the header the frame draws for it. */
const Slot = createContext<{
  element: HTMLElement | null
  set: (element: HTMLElement | null) => void
} | null>(null)

/** Gives the header drawn inside it a place for the buttons of the Pane
 * drawn inside it ({@link InHeader}). */
function HeaderSlot({ children }: { children: ReactNode }) {
  const [element, set] = useState<HTMLElement | null>(null)
  const slot = useMemo(() => ({ element, set }), [element])
  return <Slot value={slot}>{children}</Slot>
}

/** A Pane's buttons, drawn in its tile's header before the window's own;
 * nowhere when the tile draws no header. */
function InHeader({ children }: { children: ReactNode }) {
  const element = useContext(Slot)?.element
  return element ? createPortal(children, element) : null
}

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
  children,
}: {
  /** What the close button closes, for its label. */
  title: string
  /** The Pane's kind's icon, drawn first. */
  icon?: LucideIcon | undefined
  onClose: () => void
  className?: string
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
        <span ref={useContext(Slot)?.set} className="contents" />
        {useContext(TileActions)}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Close ${title}`}
          title="Close (Alt+W)"
          className="shrink-0 opacity-0 transition-opacity group-hover/tile:opacity-100 group-data-[selected=true]/tile:opacity-100 focus-visible:opacity-100"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
    </header>
  )
}

export { HeaderSlot, InHeader, PaneHeader, TileActions }
