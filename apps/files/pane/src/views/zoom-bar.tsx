/**
 * The quiet bar at the foot of a picture or a PDF: what the view says
 * first, as the page shown, then its zoom out, its scale and its zoom in.
 * A press on it is its own, not the view's under it.
 */
import type { ReactNode } from "react"
import { Button } from "@banda/ui/components/button"
import { MinusIcon, PlusIcon } from "lucide-react"

export function ZoomBar({
  scale,
  title,
  onOut,
  onIn,
  onFit,
  children,
}: {
  /** The scale, as it reads: `125%`. */
  scale: string
  /** What the scale's tooltip says. */
  title: string
  onOut: () => void
  onIn: () => void
  /** A click on the scale fits the view again; none where it does not. */
  onFit?: () => void
  children?: ReactNode
}) {
  return (
    <div
      className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 cursor-default items-center gap-0.5 rounded-control bg-popover/80 p-0.5 text-meta text-muted-foreground shadow-sm ring-1 ring-foreground/10 backdrop-blur"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {children}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Zoom out"
        title="Zoom out"
        onClick={onOut}
      >
        <MinusIcon />
      </Button>
      {onFit ? (
        <button
          type="button"
          aria-label="Zoom"
          title={title}
          className="min-w-11 text-center tabular-nums hover:text-foreground"
          onClick={onFit}
        >
          {scale}
        </button>
      ) : (
        <span
          aria-label="Zoom"
          title={title}
          className="min-w-10 text-center tabular-nums"
        >
          {scale}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Zoom in"
        title="Zoom in"
        onClick={onIn}
      >
        <PlusIcon />
      </Button>
    </div>
  )
}
