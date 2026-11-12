import { cn } from "@banda/ui/lib/utils"
import { useEffect, useLayoutEffect, useRef } from "react"
import type { ProjectId, ProjectSummary } from "@banda/contract"
import { onPage, PANE_LAYER, type PaneState } from "@banda/ui/pane"
import { moveOf } from "../look"
import { Moving } from "../motion"
import type { Entry, Gone, Workspaces as State } from "./model"
import type { Frame } from "./PaneFrame"
import type { Reveal } from "./layout"
import type { Shows } from "./shows"
import { Strip } from "./Strip"
import { useModHeld } from "./held"
import { pixels, Swipe } from "./swipe"
import { stacked } from "./tiles"
import { type Carrying, inStrip, refusing, useMoving } from "./useMoving"
import { useHoldsMod } from "@banda/ui/hooks/use-key-of"

/** How far a swipe goes, in pixels, before it moves a workspace. */
const STEP = 24

/**
 * The workspaces one under another, as niri stacks them: the current one
 * fills the screen, and moving to another slides the stack up or down.
 * Every workspace stays drawn, so its Panes keep running; only the current
 * one takes clicks and keys, and none while the overview covers them.
 */
export function Workspaces({
  workspaces,
  covered,
  overview,
  modules,
  projectOf,
  strict,
  gone,
  shows,
  marked,
  away,
  zoomed,
  reveal,
  inset,
  frame,
  onStep,
  onGo,
  onStart,
}: {
  workspaces: State
  /** The overview or the drawer covers them: no Pane has the focus. */
  covered: boolean
  /** The overview shows them zoomed out, each under its row there, which
   * places it (`Overview`): the stack stands still. */
  overview: boolean
  modules: readonly string[]
  projectOf: (project: ProjectId) => ProjectSummary | undefined
  /** In the row and solo, where a Project's workspace holds its Panes
   * only (ADR 0102). */
  strict: boolean
  /** Whether a Project's emptied workspace goes (`Strip`). */
  gone: Gone
  /** What the Panes show, as their Apps list it, and how each calls. */
  shows: Shows
  /** An Agent opened it, and the Person has not looked at it yet. */
  marked: (entry: Entry) => boolean
  /** The Panes in windows of their own, which stand-ins keep the places of. */
  away: ReadonlySet<string>
  /** The Pane shown over the whole window, if one is. */
  zoomed: string | undefined
  /** A column to show once, as asked: Alt+C's, or a Thread picked. */
  reveal?: Reveal
  /** How far the sidebar reaches over their left, in rem (`Strip`). */
  inset: number
  frame: Frame
  /** A swipe up or down with the mod held steps once, however long it is. */
  onStep: (by: 1 | -1) => void
  /** Goes to workspace `id`, as a Pane carried and held over its number
   * in the bar does. */
  onGo: (id: string) => void
  onStart: (pane: PaneState) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  // The stack's place, in workspaces: it moves on the look's spring.
  const place = useRef<Moving | null>(null)
  useLayoutEffect(() => {
    const stack = root.current
    if (!stack) return
    place.current ??= stackPlace(stack, workspaces.current)
    const moving = place.current
    // The overview owns the transforms. Keep the stack's resting place
    // ready for the workspace the overview grows back on closing.
    if (overview) {
      moving.to(workspaces.current, { kind: "off" })
      return
    }
    // A workspace just drawn takes its place in the stack as it stands,
    // and so does every one when the overview, which placed them, closes.
    if (!moving.moving) moving.to(moving.value, { kind: "off" })
    if (moving.target !== workspaces.current) {
      // One Project's workspace swaps for another's in place: the new one
      // fades in, a little from the left, with no slide (ADR 0065,
      // decision 9).
      const from = workspaces.list[Math.round(moving.target)]?.project
      const to = workspaces.list[workspaces.current]?.project
      const swapping = from !== undefined && to !== undefined && from !== to
      const move = moveOf("workspace")
      moving.to(workspaces.current, swapping ? { kind: "off" } : move)
      if (swapping && move.kind !== "off") {
        stack.animate(
          [
            { opacity: 0.25, translate: "-10px 0" },
            { opacity: 1, translate: "0 0" },
          ],
          { duration: 240, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
        )
      }
    }
  })
  useEffect(() => () => place.current?.stop(), [])
  // Each Tile's state, as the workspaces stand and where they slide (ADR
  // 0088, decision 4): the workspace a key goes to shows in the key's task.
  // A new `current` is read through `place`, which the effect above just
  // sent there.
  const { list, current } = workspaces
  useLayoutEffect(() => {
    const moving = place.current
    if (!moving) return
    stacked({
      order: list.map((workspace) => workspace.id),
      place: moving,
      overview,
    })
  }, [list, current, overview])
  useLayoutEffect(() => () => stacked(undefined), [])
  // A page in the layer takes the keys as `onPage` says: the tile that
  // holds the page takes the focus then and there.
  useEffect(
    () =>
      onPage((holder) => {
        const tile = holder.closest<HTMLElement>("[data-tile]")
        if (tile?.dataset.tile && tile.dataset.focused !== "true")
          frame.focus(tile.dataset.tile)
      }),
    [frame]
  )
  const step = useRef(onStep)
  // What the mouse's moving reads as it goes.
  const carrying = useRef<Carrying>({
    on: false,
    frame,
    go: onGo,
    ...inStrip(undefined),
  })
  useLayoutEffect(() => {
    step.current = onStep
    carrying.current = {
      on: !covered && zoomed === undefined,
      frame,
      go: onGo,
      ...inStrip(workspaces.list[workspaces.current]?.id),
      ...refusing(workspaces, strict, projectOf),
    }
  })
  useMoving(root, carrying)
  useModHeld()
  const holdsMod = useHoldsMod()
  useEffect(() => {
    const element = root.current
    if (!element) return
    const swipe = new Swipe()
    let stepped = false
    // With the mod held the wheel is the window's: no Pane scrolls under it.
    const onWheel = (event: WheelEvent) => {
      const { x, y } = pixels(event)
      if (swipe.add(x, y, event.timeStamp)) stepped = false
      if (!holdsMod(event)) return
      event.preventDefault()
      if (stepped || swipe.way !== "upright" || Math.abs(swipe.y) < STEP) {
        return
      }
      stepped = true
      step.current(swipe.y > 0 ? 1 : -1)
    }
    element.addEventListener("wheel", onWheel, { passive: false })
    return () => element.removeEventListener("wheel", onWheel)
  }, [holdsMod])
  return (
    // Clipped, not hidden: the stack moves by transforms only, and nothing
    // scrolled into view in a Pane may slide the next workspace in. Its own
    // stacking context keeps the layer under the overview and the toasts.
    // An area of the window: what changes in it lays out and paints nothing
    // outside it (ADR 0088, decision 8).
    <div
      ref={root}
      data-overview={overview || undefined}
      className="relative isolate h-full min-h-0 overflow-clip [contain:layout_paint_style]"
    >
      {overview && (
        <div
          data-overview-backdrop=""
          className="pointer-events-none absolute inset-0 bg-overview opacity-0"
        />
      )}
      {workspaces.list.map((workspace, i) => {
        const current = i === workspaces.current
        const live = current && !covered
        return (
          <div
            key={workspace.id}
            role="group"
            aria-label={`Workspace ${i + 1}`}
            aria-hidden={!live}
            inert={!live}
            data-stack={workspace.id}
            className={cn(
              "absolute inset-0 origin-top-left",
              // A plate of its own: the overview sizes it to what shows of
              // the Strip, from its screen to the whole of it, and rounds it
              // round the tiles, the outer gap between them.
              overview &&
                "overflow-clip rounded-window bg-desk glass:bg-transparent",
              // An empty one shows as its slim row in the overview alone.
              overview &&
                workspace.columns.length === 0 &&
                "invisible opacity-0"
            )}
          >
            <Strip
              workspace={workspace}
              live={live}
              selected={current && (overview || live)}
              modules={modules}
              projectOf={projectOf}
              strict={strict}
              gone={gone}
              shows={shows}
              marked={marked}
              away={away}
              zoomed={zoomed}
              reveal={reveal}
              inset={inset}
              frame={frame}
              onStep={onStep}
              onStart={onStart}
            />
          </div>
        )
      })}
      {/* What Panes keep drawn wherever they move, as browser pages. */}
      <div
        {...{ [PANE_LAYER]: "" }}
        className="pointer-events-none absolute inset-0 z-1"
      />
      {overview && (
        <div
          data-overview-focus-clip=""
          aria-hidden="true"
          className="pointer-events-none invisible absolute top-0 left-0 z-2 overflow-clip"
        >
          <div
            data-overview-focus=""
            className="absolute top-0 left-0 outline-[length:calc(var(--tile-border)+var(--focus-ring))] outline-offset-[calc(-1*var(--tile-border))] outline-focus outline-solid"
          />
        </div>
      )}
    </div>
  )
}

/** Where the stack stands, in workspaces: 1.5 shows half of the second
 * and half of the third. */
function stackPlace(stack: HTMLElement, at: number): Moving {
  let shown = at
  return new Moving(
    (place) => {
      shown = place
      // The overview places them while it is open.
      if (stack.dataset.overview != null) return
      const screens = stack.querySelectorAll<HTMLElement>(
        ":scope > [data-stack]"
      )
      for (const [i, child] of [...screens].entries()) {
        child.style.transform = `translateY(${(i - place) * 100}%)`
      }
    },
    () => shown
  )
}
