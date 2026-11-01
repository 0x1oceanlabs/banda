import { useEffect, useLayoutEffect, useRef } from "react"
import type { Engine, SpaceId } from "@bandaso/contract"
import type { PaneState } from "@bandaso/ui/pane"
import type { Workspaces as State } from "./model"
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
  frame: Frame
  /** A swipe up or down with Alt held steps once, however long it is. */
  onStep: (by: 1 | -1) => void
  onStart: (pane: PaneState) => void
}) {
  const root = useRef<HTMLDivElement>(null)
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
    <div ref={root} className="relative h-full min-h-0 overflow-hidden">
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
            className="absolute inset-0 transition-transform duration-300 ease-out motion-reduce:transition-none"
            style={{
              transform: `translateY(${(i - workspaces.current) * 100}%)`,
            }}
          >
            <Strip
              workspace={workspace}
              live={live}
              engine={engine}
              modules={modules}
              spaceName={spaceName}
              frame={frame}
              onStart={onStart}
            />
          </div>
        )
      })}
    </div>
  )
}
