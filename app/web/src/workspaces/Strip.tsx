import { useLayoutEffect, useRef } from "react"
import type { Engine, SpaceId } from "@bandaso/contract"
import type { PaneState } from "@bandaso/ui/pane"
import { Choices } from "../registry"
import type { Width, Workspace } from "./model"
import { type Frame, PaneFrame } from "./PaneFrame"

const SHARE: Record<Width, number> = {
  "1/3": 1 / 3,
  "1/2": 1 / 2,
  "2/3": 2 / 3,
  "1": 1,
}

/**
 * One workspace, as niri's Strip: columns side by side, each its share of
 * the screen's width, scrolling sideways. The focused column always comes
 * fully into view, by the least scroll that shows it.
 */
export function Strip({
  workspace,
  live,
  engine,
  modules,
  spaceName,
  frame,
  onStart,
}: {
  workspace: Workspace
  /**
   * Whether it takes clicks and keys: it is on screen and the overview does
   * not cover it. Only then its focus is a Pane's.
   */
  live: boolean
  engine: Engine
  modules: readonly string[]
  spaceName: (space: SpaceId) => string
  frame: Frame
  /** Opens a first Pane on this empty workspace. */
  onStart: (pane: PaneState) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const focus = workspace.columns[workspace.focus]?.id
  const widths = workspace.columns.map((column) => column.width).join()

  useLayoutEffect(() => {
    const strip = scroller.current
    const column = strip?.querySelector<HTMLElement>(`[data-column="${focus}"]`)
    if (!strip || !column) return
    // The look's outer gap stays in view beside the column.
    const gap = parseFloat(getComputedStyle(strip).paddingLeft) || 0
    const start = column.offsetLeft - gap
    const end = column.offsetLeft + column.offsetWidth + gap
    if (start < strip.scrollLeft) {
      strip.scrollTo({ left: start, behavior: "smooth" })
    } else if (end > strip.scrollLeft + strip.clientWidth) {
      strip.scrollTo({ left: end - strip.clientWidth, behavior: "smooth" })
    }
  }, [focus, widths])

  if (workspace.columns.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-muted-foreground">
          This workspace is empty. Open a Pane:
        </p>
        <Choices modules={modules} onPick={onStart} />
      </div>
    )
  }

  const spaces = new Set(
    workspace.columns.flatMap((column) => column.entries.map((e) => e.space))
  )
  const mixed = spaces.size > 1
  return (
    <div
      ref={scroller}
      className="relative flex h-full gap-(--gap-inner) overflow-x-auto overflow-y-hidden p-(--gap-outer)"
    >
      {workspace.columns.map((column, c) => (
        <div
          key={column.id}
          data-column={column.id}
          className="flex h-full shrink-0 flex-col gap-(--gap-inner)"
          style={{
            // Shares of the room the Strip shows, gaps between them included.
            width: `calc(${SHARE[column.width]} * (100% + var(--gap-inner)) - var(--gap-inner))`,
          }}
        >
          {column.entries.map((entry, e) => (
            <PaneFrame
              key={entry.id}
              entry={entry}
              engine={engine}
              modules={modules}
              focused={live && workspace.focus === c && column.active === e}
              spaceName={mixed ? spaceName(entry.space) : undefined}
              frame={frame}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
