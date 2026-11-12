import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { XIcon, type LucideIcon } from "lucide-react"
import { cn } from "../lib/utils"
import { Button } from "./button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "./context-menu"
import { useKeyLabel } from "../hooks/use-key-of"

/**
 * What the window gives every Pane's header, its own or the frame's (ADR
 * 0066): Banda's buttons at the header's end, and the Pane menu's rows
 * for a right click.
 */
type Tile = {
  /** Banda's buttons, after the Pane's own: the Pane menu's. */
  actions?: ReactNode
  /** The Pane menu's rows, which a right click on the header opens. */
  menu?: ReactNode
  /** What a double click on the header does: its column the whole screen
   * wide, and back. */
  onWide?: () => void
}
const TileHeader = createContext<Tile>({})

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

/** A Pane's buttons, drawn at its tile's header's end before the window's own;
 * nowhere when the tile draws no header. */
function InHeader({ children }: { children: ReactNode }) {
  const element = useContext(Slot)?.element
  return element ? createPortal(children, element) : null
}

/** What in a header answers a click itself, as the browser's row of tabs:
 * the mouse's own gestures leave it be. */
const CONTROLS =
  "button, input, textarea, select, a, [contenteditable], [role=tablist]"

const onControl = (event: MouseEvent) =>
  event.target instanceof Element && event.target.closest(CONTROLS) !== null

/**
 * A tile's header: one row as tall as every Pane's, with what the Pane puts
 * in it, then its buttons at its right end: the Pane's own, a line, then
 * the window's and close (ADR 0066, decision 2, as amended). They show on
 * every Pane, on no plate, faint until the Pane has the focus or the
 * pointer.
 *
 * The frame draws it for most Panes; a Pane that draws its own (`header:
 * false`) draws it with this. The mouse carries the Pane by it
 * (`data-handle`); a double click makes its column the whole screen wide,
 * a middle click closes it, a right click opens the Pane menu.
 */
function PaneHeader({
  title,
  icon: Icon,
  onClose,
  closeTitle,
  className,
  children,
}: {
  /** What the close button closes, for its label. */
  title: string
  /** The Pane's kind's icon, drawn first. */
  icon?: LucideIcon | undefined
  onClose: () => void
  /** The close button's tooltip, where another key closes it than a
   * Pane's. */
  closeTitle?: string
  className?: string
  children: ReactNode
}) {
  const keyFor = useKeyLabel()
  const tile = useContext(TileHeader)
  const slot = useContext(Slot)
  const header = (
    <header
      data-handle=""
      className={cn(
        "flex h-9 shrink-0 items-center gap-2 border-b px-2.5 text-ui",
        className
      )}
      onDoubleClick={(event) => {
        if (tile.onWide && !onControl(event)) tile.onWide()
      }}
      // A middle press would scroll the page, or paste on Linux.
      onMouseDown={(event) => {
        if (event.button === 1 && !onControl(event)) event.preventDefault()
      }}
      onAuxClick={(event) => {
        if (event.button !== 1 || onControl(event)) return
        event.preventDefault()
        onClose()
      }}
    >
      {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
      {children}
      <div
        data-slot="pane-buttons"
        className="ml-auto flex shrink-0 items-center gap-px text-muted-foreground/70 transition-colors group-hover/tile:text-muted-foreground group-data-[selected=true]/tile:text-muted-foreground"
      >
        <span
          ref={slot?.set}
          data-own=""
          className="flex items-center gap-px empty:hidden"
        />
        <span
          aria-hidden
          className="mx-0.5 h-3.5 w-px shrink-0 bg-foreground/10 [[data-own]:empty+&]:hidden"
        />
        {tile.actions}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Close ${title}`}
          title={closeTitle ?? keyFor("pane.close", "Close")}
          className="shrink-0"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </div>
    </header>
  )
  if (!tile.menu) return header
  return (
    <ContextMenu>
      <ContextMenuTrigger render={header} />
      <ContextMenuContent aria-label="Pane menu" className="w-72">
        {tile.menu}
      </ContextMenuContent>
    </ContextMenu>
  )
}

export { HeaderSlot, InHeader, PaneHeader, TileHeader }
