import { memo, useLayoutEffect, useMemo, useRef } from "react"
import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { Button } from "@banda/ui/components/button"
import { cn } from "@banda/ui/lib/utils"
import type { PaneState } from "@banda/ui/pane"
import { PinIcon } from "lucide-react"
import { boxOf } from "@banda/ui/lib/tile"
import { type Shows, useListed } from "../tiling/shows"
import type { Entry } from "../tiling/model"
import { type Frame, PaneFrame } from "../tiling/PaneFrame"

/**
 * The drawer (ADR 0025, decision 8): a Thread that drops from the top
 * over the workspace, as a terminal that drops down does. Lifted, it is
 * kept drawn, so it stays as it was; its pin makes it a column of the
 * workspace on screen. It is the window's, in no workspace. The workspace
 * under it is covered, so its focus comes back when it is lifted.
 */
export const Drawer = memo(function Drawer({
  entry,
  shown,
  height,
  engine,
  modules,
  shows,
  projectOf,
  frame,
  onLift,
  onPin,
  onChange,
  onClose,
}: {
  entry: Entry
  shown: boolean
  /** How far down it drops: a share of the room under the bar. */
  height: number
  engine: Engine
  modules: readonly string[]
  /** What its Pane shows, as its App lists it. */
  shows: Shows
  projectOf: (id: ProjectId) => ProjectSummary | undefined
  /** The workspaces' frame: what its Pane opens goes there. */
  frame: Frame
  onLift: () => void
  onPin: () => void
  onChange: (pane: PaneState) => void
  onClose: () => void
}) {
  const listed = useListed(shows, entry)
  const own: Frame = useMemo(
    () => ({
      // The focus is the drawer's while it shows; the workspace keeps its own.
      focus: () => undefined,
      open: (project, pane, _from, place) =>
        frame.open(project, pane, "", place),
      update: (_entry, pane) => onChange(pane),
      close: onClose,
      run: frame.run,
      arrange: frame.arrange,
      // It is no workspace's, so it has no place to keep for a window of
      // its own: it has no pop-out.
    }),
    [frame, onChange, onClose]
  )
  // Lifted, its Tile is hidden once it slid away; dropped, it shows at
  // once, before it slides in (ADR 0088, decision 4).
  const dialog = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = dialog.current
    const tile = element?.querySelector("[data-tile]")
    const box = tile && boxOf(tile)
    if (!element || !box) return
    if (shown) {
      box.configure("shown")
      return
    }
    // Asking for its transitions has its slide start, unless motion is off.
    if (element.getAnimations().length === 0) {
      box.configure("hidden")
      return
    }
    const slid = (event: Event) => {
      if (event.target === element) box.configure("hidden")
    }
    element.addEventListener("transitionend", slid)
    element.addEventListener("transitioncancel", slid)
    return () => {
      element.removeEventListener("transitionend", slid)
      element.removeEventListener("transitioncancel", slid)
    }
  }, [shown])
  const pin = useMemo(
    () => (
      <Button
        variant="ghost"
        size="xs"
        className="shrink-0 text-muted-foreground"
        title="A column of this workspace"
        onClick={onPin}
      >
        <PinIcon />
        Pin
      </Button>
    ),
    [onPin]
  )
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden">
      <div
        aria-hidden
        onPointerDown={onLift}
        className={cn(
          "absolute inset-0 bg-black/10 transition-opacity duration-200 motion-reduce:transition-none",
          shown ? "pointer-events-auto opacity-100" : "opacity-0"
        )}
      />
      {/* A dialog over the workspace: the window's keys that work its
          Panes wait until it is lifted. */}
      <div
        ref={dialog}
        role="dialog"
        aria-label="Drawer"
        inert={!shown}
        data-drawer={shown || undefined}
        onKeyDown={(event) => {
          // Esc lifts it, but for what in it keeps its Esc and stops it
          // there: a text field's prevents its default always.
          if (event.key === "Escape") onLift()
        }}
        style={{ height: `calc(${height * 100}% - var(--gap-outer))` }}
        className={cn(
          "pointer-events-auto absolute top-0 right-(--gap-outer) left-[calc(var(--gap-outer)+var(--sidebar-inset))] flex transition-transform duration-200 ease-out motion-reduce:transition-none",
          shown ? "translate-y-0" : "-translate-y-[calc(100%+var(--gap-outer))]"
        )}
      >
        <PaneFrame
          entry={entry}
          engine={engine}
          modules={modules}
          focused={shown}
          marked={false}
          listed={listed}
          project={projectOf(entry.project)}
          mixed={false}
          frame={own}
          actions={pin}
        />
      </div>
    </div>
  )
})
