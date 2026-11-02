import { useEffect, useLayoutEffect, useRef } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import {
  holderOf,
  type Listed,
  PANE_LAYER,
  type PaneState,
} from "@banda/ui/pane"
import { moveOf } from "../look"
import { Moving } from "../motion"
import type { Chime } from "@banda/ui/sound"
import type { Entry, Workspaces as State } from "./model"
import type { Frame } from "./PaneFrame"
import { Strip } from "./Strip"
import { pixels, Swipe } from "./swipe"

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
  engine,
  modules,
  spaceName,
  called,
  marked,
  zoomed,
  center,
  listed,
  frame,
  onStep,
  onStart,
}: {
  workspaces: State
  /** The overview covers them: no Pane has the focus. */
  covered: boolean
  engine: Engine
  modules: readonly string[]
  spaceName: (space: SpaceId) => string
  /** How the Thread a Pane shows calls the Person, if it does. */
  called: (entry: Entry) => Chime | undefined
  /** An Agent opened it, and the Person has not looked at it yet. */
  marked: (entry: Entry) => boolean
  /** The Pane shown over the whole window, if one is. */
  zoomed: string | undefined
  /** Counts Alt+C, for the current workspace's Strip. */
  center: number
  /** The listed thing a Pane shows, as its module lists it. */
  listed: (entry: Entry) => Listed | undefined
  frame: Frame
  /** A swipe up or down with Alt held steps once, however long it is. */
  onStep: (by: 1 | -1) => void
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
    // A workspace just drawn takes its place in the stack as it stands.
    if (!moving.moving) moving.to(moving.value, { kind: "off" })
    if (moving.target !== workspaces.current) {
      moving.to(workspaces.current, moveOf("workspace"))
    }
  })
  useEffect(() => () => place.current?.stop(), [])
  // A page in the layer takes the keys as an iframe does, with no focus
  // event of its own: the focus leaves for it, or the window blurs as it
  // takes it. The tile that holds the page takes the focus then and there.
  useEffect(() => {
    const take = (element: Element | null) => {
      const tile = holderOf(element)?.closest<HTMLElement>("[data-tile]")
      if (tile?.dataset.tile && tile.dataset.focused !== "true")
        frame.focus(tile.dataset.tile)
    }
    const onLeave = (event: FocusEvent) =>
      take(event.relatedTarget as Element | null)
    const onBlur = () => take(document.activeElement)
    document.addEventListener("focusout", onLeave, true)
    window.addEventListener("blur", onBlur)
    return () => {
      document.removeEventListener("focusout", onLeave, true)
      window.removeEventListener("blur", onBlur)
    }
  }, [frame])
  const step = useRef(onStep)
  useLayoutEffect(() => {
    step.current = onStep
  })
  useEffect(() => {
    const element = root.current
    if (!element) return
    const swipe = new Swipe()
    let stepped = false
    // With Alt held the wheel is the window's: no Pane scrolls under it.
    const onWheel = (event: WheelEvent) => {
      const { x, y } = pixels(event)
      if (swipe.add(x, y, event.timeStamp)) stepped = false
      if (!event.altKey) return
      event.preventDefault()
      if (stepped || swipe.way !== "upright" || Math.abs(swipe.y) < STEP) {
        return
      }
      stepped = true
      step.current(swipe.y > 0 ? 1 : -1)
    }
    element.addEventListener("wheel", onWheel, { passive: false })
    return () => element.removeEventListener("wheel", onWheel)
  }, [])
  return (
    // Clipped, not hidden: the stack moves by transforms only, and nothing
    // scrolled into view in a Pane may slide the next workspace in. Its own
    // stacking context keeps the layer under the overview and the toasts.
    <div ref={root} className="relative isolate h-full min-h-0 overflow-clip">
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
            className="absolute inset-0"
          >
            <Strip
              workspace={workspace}
              live={live}
              engine={engine}
              modules={modules}
              spaceName={spaceName}
              called={called}
              marked={marked}
              zoomed={zoomed}
              center={center}
              listed={listed}
              frame={frame}
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
      for (const [i, child] of [...stack.children].entries()) {
        ;(child as HTMLElement).style.transform =
          `translateY(${(i - place) * 100}%)`
      }
    },
    () => shown
  )
}
