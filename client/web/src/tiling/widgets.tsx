/**
 * The Tiling's widgets on the Bar (ADR 0087, decision 5): the workspaces,
 * and the pill that says the workspaces are set
 * aside. The Tiling is the
 * middle's program, and the Bar shows its workspaces as a bar shows a
 * compositor's; where they stand is the look's `[bar]`, by their ids
 * (`widget-ids.ts`). Each is given the engine and the Projects, as every
 * widget is (decision 11): what it reads of the Tiling, it reads by
 * selector from what the Window keeps (`kept.ts`), and a click runs an
 * action by its id.
 */
import type { ProjectSummary } from "@banda/contract"
import { sameData, useRun } from "@banda/core/react"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { cn } from "@banda/ui/lib/utils"
import type { Widget, WidgetProps } from "@banda/ui/module"
import { PlusIcon } from "lucide-react"
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { AsidePill } from "./AsidePill"
import { BarMotion } from "./bar-motion"
import { AsideContext, useTiled } from "./kept"
import { type InBar, inBar, type Workspaces } from "./model"
import { ASIDE, WORKSPACES } from "./widget-ids"

/** A workspace as the bar shows it: a Project's by its Sign (ADR 0102,
 * decision 2), when the window knows the Project. */
type BarWorkspace = InBar & { owner?: ProjectSummary }

/** What the bar reads of the workspaces: those it shows, and the one on
 * screen. Made afresh each time, it is told by `sameData`, so a key that
 * moves only the focus draws the bar not. */
function barOf(state: Workspaces): {
  list: InBar[]
  current: number
} {
  return { list: inBar(state), current: state.current }
}

/** The workspaces the bar shows, drawn again only as they change. A click
 * goes to one by its place, as the keys of `workspace.go-N` reach only
 * the first nine. */
function WorkspacesWidget({ projects }: WidgetProps) {
  const bar = useTiled(barOf, sameData)
  const run = useRun()
  const shown = useMemo(
    () =>
      bar.list.map((w) => {
        const owner = w.project && projects.find((p) => p.id === w.project)
        return owner ? { ...w, owner } : w
      }),
    [bar, projects]
  )
  return (
    <WorkspaceList
      workspaces={shown}
      current={bar.current}
      onPick={(index) => run("workspace.go", { index })}
    />
  )
}

/** The pill, while the workspaces are set aside (ADR 0039, decision 2). */
function AsideWidget({ engine }: WidgetProps) {
  const aside = useContext(AsideContext)
  return aside ? <AsidePill engine={engine} aside={aside} /> : null
}

/** The Tiling's widgets, which the window's own module lists. */
export const tilingWidgets: readonly Widget[] = [
  {
    id: WORKSPACES,
    about:
      "The workspaces: a free one by its number, a Project's by its Sign; click one to go there.",
    Widget: WorkspacesWidget,
    compact: true,
  },
  {
    id: ASIDE,
    about:
      "Says the workspaces are set aside after a start that went wrong, and brings them back.",
    Widget: AsideWidget,
    // No action brings the workspaces back, only its button: it stays.
    compact: true,
  },
]

/** How wide each workspace is drawn in the bar, in rem: the mark's 1.5rem
 * and a hair each side. */
const CELL = 1.625

/**
 * The workspaces, one cell each, from the top down: a free one by its
 * number, a Project's by its Sign, faint while it is empty and keeps its
 * place, and the empty one at the bottom as `+`. The number is the
 * workspace's place, so it is its `Alt+N`, and a Sign takes a place too.
 * They come, go and mark the one on screen on the look's `workspace`
 * move, with the screen.
 */
function WorkspaceList({
  workspaces,
  current,
  onPick,
}: {
  workspaces: readonly BarWorkspace[]
  current: number
  onPick: (index: number) => void
}) {
  const keyFor = useKeyLabel()
  const nav = useRef<HTMLElement>(null)
  const mark = useRef<HTMLSpanElement>(null)
  const motion = useRef<BarMotion>(null)
  motion.current ??= new BarMotion()
  const cells = workspaces.map((w) => ({ id: w.id, width: CELL }))
  const left = workspaces.findIndex((w) => w.index === current) * CELL
  useLayoutEffect(() => {
    motion.current?.sync(nav.current, cells, mark.current, left)
  })
  useEffect(() => () => motion.current?.stop(), [])
  return (
    <nav
      ref={nav}
      aria-label="Workspaces"
      className="relative flex items-center"
    >
      <span
        ref={mark}
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-[0.0625rem] -mt-3 size-6 rounded-control bg-muted"
      />
      {workspaces.map((w) => {
        const number = String(w.index + 1)
        const name = w.bottom ? "New workspace" : `Workspace ${number}`
        // A Project's says whose it is when the pointer rests on it.
        const whose = w.owner ? `${w.owner.name}: ` : ""
        return (
          <button
            key={w.id}
            data-workspace={w.id}
            type="button"
            aria-current={w.index === current || undefined}
            aria-label={name}
            title={
              w.bottom
                ? keyFor("workspace.new", name)
                : `${whose}${keyFor(`workspace.go-${number}`, name)}`
            }
            className="relative flex h-6 shrink-0 items-center justify-center overflow-hidden rounded-control text-xs text-muted-foreground tabular-nums outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current]:font-medium aria-[current]:text-foreground"
            onClick={() => onPick(w.index)}
          >
            {w.bottom ? (
              <PlusIcon className="size-3.5 shrink-0" />
            ) : w.owner ? (
              <ProjectSign
                project={w.owner}
                className={cn(w.empty && "opacity-45")}
              />
            ) : (
              number
            )}
          </button>
        )
      })}
    </nav>
  )
}
