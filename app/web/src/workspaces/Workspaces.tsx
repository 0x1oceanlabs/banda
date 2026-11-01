import { useRef } from "react"
import type { Engine, SpaceId } from "@bandaso/contract"
import type { PaneState } from "@bandaso/ui/pane"
import type { Workspaces as State } from "./model"
import type { Frame } from "./PaneFrame"
import { Strip } from "./Strip"

/** A wheel's turn moves one workspace; the rest of a swipe waits this long. */
const WHEEL_PAUSE = 300

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
  /** The wheel with Alt held steps up or down. */
  onStep: (by: 1 | -1) => void
  onStart: (pane: PaneState) => void
}) {
  const wheeled = useRef(0)
  return (
    <div
      className="relative h-full min-h-0 overflow-hidden"
      onWheel={(event) => {
        if (!event.altKey || event.deltaY === 0) return
        if (event.timeStamp - wheeled.current < WHEEL_PAUSE) return
        wheeled.current = event.timeStamp
        onStep(event.deltaY > 0 ? 1 : -1)
      }}
    >
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
