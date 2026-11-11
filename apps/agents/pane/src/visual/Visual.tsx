/**
 * A Visual in its Thread (ADR 0037): the Agent's page in its Frame, with
 * its title under it. It opens over the window, to zoom in, or as a Pane
 * of its own (decision 6).
 */
import { useState } from "react"
import {
  Maximize2Icon,
  MinusIcon,
  PanelRightIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"
import { Button } from "@banda/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@banda/ui/components/dialog"
import { Kbd } from "@banda/ui/components/kbd"
import { useScope } from "@banda/ui/hooks/use-scope"
import { zoomHandlers } from "@banda/ui/hooks/use-zoom"
import { zoomBy, type ZoomStep } from "@banda/ui/lib/zoom"
import { VISUAL } from "../scopes"
import { type VisualArgs, VisualFrame, type VisualPlace } from "./Frame"
import { ZOOMS } from "./visual-frame"

/** A Visual in its Thread, with its title under it and, on hover, the
 * ways to open it larger in a reserved row above the page. */
export function Visual({
  place,
  visual,
  onOpen,
}: {
  place: VisualPlace
  visual: VisualArgs
  /** Opens it as a Pane of its own, beside the Thread. */
  onOpen: () => void
}) {
  const [previewing, setPreviewing] = useState(false)
  return (
    <figure className="group/visual">
      {/* Keep the actions above the page, with their space reserved so
          revealing them never covers content or moves the frame. */}
      <div className="mb-1 flex justify-end">
        <div className="flex gap-0.5 rounded-control bg-popover p-0.5 text-popover-foreground opacity-0 shadow-sm ring-1 ring-foreground/10 transition-opacity group-hover/visual:opacity-100 focus-within:opacity-100">
          <Button variant="ghost" size="xs" onClick={() => setPreviewing(true)}>
            <Maximize2Icon />
            Preview
          </Button>
          <Button variant="ghost" size="xs" onClick={onOpen}>
            <PanelRightIcon />
            Open as Pane
          </Button>
        </div>
      </div>
      <VisualFrame
        place={place}
        {...visual}
        // The page's own gutter sits in the Thread's margin.
        className="-mx-2"
      />
      <figcaption className="mt-1.5 text-xs text-muted-foreground">
        {visual.title}
      </figcaption>
      <VisualPreview
        place={place}
        visual={visual}
        open={previewing}
        onOpenChange={setPreviewing}
        onOpen={onOpen}
      />
    </figure>
  )
}

/** A Visual over the window, as wide as the window lets it be, zoomed from
 * 50 to 200 %; `Esc` closes it, as T3 Code's full screen. */
function VisualPreview({
  place,
  visual,
  open,
  onOpenChange,
  onOpen,
}: {
  place: VisualPlace
  visual: VisualArgs
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpen: () => void
}) {
  const [zoom, setZoom] = useState(1)
  const by = (step: ZoomStep) => setZoom((now) => zoomBy(now, step))
  // Its zoom's keys (ADR 0071, decision 1).
  const scope = useScope(VISUAL, zoomHandlers("agents.visual", by))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={scope}
        showCloseButton={false}
        className="flex h-[calc(100%-4rem)] w-[calc(100%-4rem)] max-w-none flex-col gap-0 bg-background p-0 sm:max-w-none"
      >
        <div className="flex items-center gap-1 border-b px-3 py-1.5">
          <DialogTitle className="min-w-0 flex-1 truncate">
            {visual.title}
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom out"
            disabled={zoom === ZOOMS[0]}
            onClick={() => by(-1)}
          >
            <MinusIcon />
          </Button>
          <button
            type="button"
            title="Actual size"
            onClick={() => by(0)}
            className="w-12 text-center text-xs text-muted-foreground tabular-nums"
          >
            {Math.round(zoom * 100)} %
          </button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom in"
            disabled={zoom === ZOOMS.at(-1)}
            onClick={() => by(1)}
          >
            <PlusIcon />
          </Button>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              onOpenChange(false)
              onOpen()
            }}
          >
            <PanelRightIcon />
            Open as Pane
          </Button>
          <Kbd>Esc</Kbd>
          <DialogClose
            render={
              <Button variant="ghost" size="icon-xs" aria-label="Close" />
            }
          >
            <XIcon />
          </DialogClose>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
          <VisualFrame place={place} {...visual} zoom={zoom} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
