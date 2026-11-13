import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { newId, type ProjectId, type ProjectSummary } from "@banda/contract"
import type { PaneState } from "@banda/ui/pane"
import { Button } from "@banda/ui/components/button"
import { cn } from "@banda/ui/lib/utils"
import { PinIcon } from "lucide-react"
import { boxOf } from "@banda/ui/lib/tile"
import { type Shows, useItemShown } from "../tiling/shows"
import type { Entry } from "../tiling/model"
import { type Frame, PaneFrame } from "../tiling/PaneFrame"
import { keepDrawer, loadDrawer } from "../tiling/store"
import { useTop } from "./top"

/**
 * The drawer's state (ADR 0025, decision 8): its Pane, kept between runs,
 * and whether it shows. Kept from the last run, it is `drawn` from its
 * first drop in this one. `toggle` drops or lifts it, and with none has
 * `start` open one in it; `into` drops a Pane in it, in place of what it
 * held; `change` has its Pane change its entry; `take` closes it and
 * gives what it held, as its pin does.
 */
export function useDrawer() {
  const [entry, setEntry] = useState(loadDrawer)
  const [shown, setShown] = useState(false)
  const [dropped, setDropped] = useState(false)
  useEffect(() => keepDrawer(entry), [entry])
  const now = useRef(entry)
  useEffect(() => {
    now.current = entry
  }, [entry])
  const toggle = useCallback((start: () => void) => {
    if (!now.current) return start()
    setShown((shown) => !shown)
    setDropped(true)
  }, [])
  const into = useCallback((pane: PaneState, project: ProjectId) => {
    const entry = { id: newId(), project, pane }
    now.current = entry
    setEntry(entry)
    setShown(true)
    setDropped(true)
  }, [])
  const lift = useCallback(() => setShown(false), [])
  // Lifted or closed, it stays so as its Pane changes its entry.
  const close = useCallback(() => {
    setShown(false)
    setEntry(undefined)
  }, [])
  const change = useCallback(
    (how: (was: Entry) => Entry) => setEntry((was) => was && how(was)),
    []
  )
  const take = useCallback(() => {
    const held = now.current
    close()
    return held
  }, [close])
  const drawn = dropped ? entry : undefined
  return useMemo(
    () => ({ drawn, shown, toggle, into, lift, close, change, take }),
    [drawn, shown, toggle, into, lift, close, change, take]
  )
}

/**
 * The drawer (ADR 0025, decision 8): a Thread that drops from the top
 * over the workspace, as a terminal that drops down does. Lifted, it is
 * kept drawn, so it stays as it was; its pin makes it a column of the
 * workspace on screen. It is the window's, in no workspace. Dropped, it
 * is on its layer of the Top layer's stack, which lifts it on an Esc
 * nothing in it kept, and gives the keys back to the workspace under it,
 * where they were.
 */
export const Drawer = memo(function Drawer({
  entry,
  shown,
  height,
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
  modules: readonly string[]
  /** The Tiling's port: whether its Pane shows an Item. */
  shows: Shows
  projectOf: (id: ProjectId) => ProjectSummary | undefined
  /** The workspaces' frame: what its Pane opens goes there. */
  frame: Frame
  onLift: () => void
  onPin: () => void
  /** Its entry, as `how` changes it. */
  onChange: (how: (was: Entry) => Entry) => void
  onClose: () => void
}) {
  const item = useItemShown(shows, entry)
  useTop(shown, { part: "drawer", layer: "drawer", keys: true, close: onLift })
  const own: Frame = useMemo(
    () => ({
      // The focus is the drawer's while it shows; the workspace keeps its own.
      focus: () => undefined,
      // What it opens in its own place stays in it, under a new ID, as a
      // draft that changes Project; the rest opens on the workspace.
      open: (project, pane, _from, place) =>
        place === "instead"
          ? onChange(() => ({ id: newId(), project, pane }))
          : frame.open(project, pane, "", place),
      update: (_entry, pane) => onChange((was) => ({ ...was, pane })),
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
    <div className="pointer-events-none absolute inset-0 z-drawer overflow-hidden">
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
        data-top="drawer"
        style={{ height: `calc(${height * 100}% - var(--gap-outer))` }}
        className={cn(
          "pointer-events-auto absolute top-0 right-(--gap-outer) left-[calc(var(--gap-outer)+var(--sidebar-inset))] flex transition-transform duration-200 ease-out motion-reduce:transition-none",
          shown ? "translate-y-0" : "-translate-y-[calc(100%+var(--gap-outer))]"
        )}
      >
        <PaneFrame
          entry={entry}
          modules={modules}
          focused={shown}
          marked={false}
          item={item}
          project={projectOf(entry.project)}
          mixed={false}
          frame={own}
          actions={pin}
          // It drops over the workspace: nothing is drawn beside it.
          noRoom
        />
      </div>
    </div>
  )
})
