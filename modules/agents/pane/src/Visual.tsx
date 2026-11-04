/**
 * A Visual in its Thread (ADR 0037): the Agent's page in a frame kept
 * apart from Banda, wearing the look and following it, as tall as the
 * page says it is. The frame has an origin of its own and no
 * `allow-same-origin`, so the page runs its scripts and nothing of
 * Banda's; what it says is heard only from its own frame. It opens over
 * the window, to zoom in, or as a Pane of its own (decision 6).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  Maximize2Icon,
  MinusIcon,
  PanelRightIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"
import type { SpaceId } from "@banda/contract"
import type { Fit, VisualId } from "@banda/contract/agents"
import { Button } from "@banda/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@banda/ui/components/dialog"
import { Kbd } from "@banda/ui/components/kbd"
import { type Key, matches } from "@banda/ui/lib/keys"
import { onThemeChange } from "@banda/ui/lib/look"
import {
  heard,
  heightAt,
  lookedAt,
  lookMessage,
  SANDBOX,
  visualAddress,
  type VisualLook,
  visualLook,
  ZOOMS,
} from "./visual-frame"

/** A Visual as its Thread keeps it, and as its Pane's args. */
export type VisualArgs = {
  visual: VisualId
  title: string
  /** How tall the Agent said it is, till the page says. */
  height: number
  /** How tall the window found it at several widths, before it loads. */
  heights: Fit[]
}

/** The look the window shows now. */
function lookNow(): VisualLook {
  const root = document.documentElement
  const style = getComputedStyle(root)
  return visualLook(
    (token) => style.getPropertyValue(token),
    root.classList.contains("dark")
  )
}

/** The page in its frame, as wide as its place and as tall as the page,
 * at `zoom`: laid out that much narrower, then drawn that much larger, as
 * a browser zooms. */
export function VisualFrame({
  space,
  visual,
  title,
  height,
  heights,
  zoom = 1,
  className,
}: VisualArgs & { space: SpaceId; zoom?: number; className?: string }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [fits, setFits] = useState<number>()
  /** How tall the frame is till its page says. */
  const [guess, setGuess] = useState(height)
  // The first look goes with the address; once the page is loaded, each
  // new one is posted, so it repaints without loading again.
  const [address] = useState(() =>
    lookedAt(visualAddress(space, visual), lookNow())
  )
  const post = () =>
    frame.current?.contentWindow?.postMessage(lookMessage(lookNow()), "*")

  useEffect(() => onThemeChange(post), [])

  // Till the page says its height, the frame takes the one the window
  // found for its width, from its first paint.
  useLayoutEffect(() => {
    const own = frame.current
    if (!own || heights.length === 0 || fits !== undefined) return
    const fit = () => setGuess(heightAt(heights, own.clientWidth, height))
    fit()
    const watch = new ResizeObserver(fit)
    watch.observe(own)
    return () => watch.disconnect()
  }, [heights, height, fits])

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      const own = frame.current
      if (!own || event.source !== own.contentWindow) return
      const said = heard(event.data)
      if (!said) return
      if (said.kind === "size") return setFits(said.height)
      // Keys still work after the click's transient activation expires.
      if (document.activeElement !== own) return
      if (said.kind === "link") {
        if (navigator.userActivation.isActive)
          window.open(said.url, "_blank", "noopener")
      }
      // A key the page left goes on from its frame, as one pressed on it.
      else
        own.dispatchEvent(
          new KeyboardEvent("keydown", {
            ...said.key,
            bubbles: true,
            cancelable: true,
          })
        )
    }
    window.addEventListener("message", listen)
    return () => window.removeEventListener("message", listen)
  }, [])

  const tall = fits ?? guess
  return (
    <div className={className} style={{ height: tall * zoom }}>
      <iframe
        ref={frame}
        src={address}
        title={title}
        sandbox={SANDBOX}
        loading="lazy"
        onLoad={post}
        style={{
          width: `${100 / zoom}%`,
          height: tall,
          transform: `scale(${zoom})`,
        }}
        // The frame's scheme is the window's, as the page's is, so it
        // stays clear over the Thread.
        className="block origin-top-left border-0 bg-transparent [color-scheme:light] dark:[color-scheme:dark]"
      />
    </div>
  )
}

/** A Visual in its Thread, with its title under it and, on hover, the
 * ways to open it larger. */
export function Visual({
  space,
  visual,
  onOpen,
}: {
  space: SpaceId
  visual: VisualArgs
  /** Opens it as a Pane of its own, beside the Thread. */
  onOpen: () => void
}) {
  const [previewing, setPreviewing] = useState(false)
  return (
    <figure className="group/visual relative">
      <VisualFrame
        space={space}
        {...visual}
        // The page's own gutter sits in the Thread's margin.
        className="-mx-2"
      />
      <div className="absolute top-2 right-0 flex gap-0.5 rounded-lg bg-popover p-0.5 text-popover-foreground opacity-0 shadow-sm ring-1 ring-foreground/10 transition-opacity group-hover/visual:opacity-100 focus-within:opacity-100">
        <Button variant="ghost" size="xs" onClick={() => setPreviewing(true)}>
          <Maximize2Icon />
          Preview
        </Button>
        <Button variant="ghost" size="xs" onClick={onOpen}>
          <PanelRightIcon />
          Open as Pane
        </Button>
      </div>
      <figcaption className="mt-1.5 text-xs text-muted-foreground">
        {visual.title}
      </figcaption>
      <VisualPreview
        space={space}
        visual={visual}
        open={previewing}
        onOpenChange={setPreviewing}
        onOpen={onOpen}
      />
    </figure>
  )
}

/** Where 100 % is in {@link ZOOMS}. */
const ACTUAL = ZOOMS.indexOf(1)

/** Ctrl or ⌘ with + − 0, as the browser Pane's zoom; keys in the page
 * stay the page's. `by` 0 goes back to 100 %. */
const ZOOM_KEYS: readonly (Key & { by: number })[] = [
  { code: "Equal", ctrl: true, by: 1 },
  { code: "Equal", ctrl: true, shift: true, by: 1 },
  { code: "Minus", ctrl: true, by: -1 },
  { code: "Digit0", ctrl: true, by: 0 },
]

/** A Visual over the window, as wide as the window lets it be, zoomed from
 * 50 to 200 %; `Esc` closes it, as T3 Code's full screen. */
function VisualPreview({
  space,
  visual,
  open,
  onOpenChange,
  onOpen,
}: {
  space: SpaceId
  visual: VisualArgs
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpen: () => void
}) {
  const [step, setStep] = useState(ACTUAL)
  const zoom = ZOOMS[step]
  const by = (steps: number) =>
    setStep((now) => Math.min(ZOOMS.length - 1, Math.max(0, now + steps)))
  const keys = (event: React.KeyboardEvent) => {
    const bind = ZOOM_KEYS.find((one) => matches(event, one))
    if (!bind) return
    event.preventDefault()
    if (bind.by === 0) setStep(ACTUAL)
    else by(bind.by)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onKeyDown={keys}
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
            disabled={step === 0}
            onClick={() => by(-1)}
          >
            <MinusIcon />
          </Button>
          <button
            type="button"
            title="Actual size"
            onClick={() => setStep(ACTUAL)}
            className="w-12 text-center text-xs text-muted-foreground tabular-nums"
          >
            {Math.round(zoom * 100)} %
          </button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom in"
            disabled={step === ZOOMS.length - 1}
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
          <VisualFrame space={space} {...visual} zoom={zoom} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
