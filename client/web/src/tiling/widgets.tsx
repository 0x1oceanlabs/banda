/**
 * The Tiling's widgets on the Bar (ADR 0087, decision 5): the workspaces,
 * as numbers or dots, and the pill that says the workspaces are set
 * aside. The Tiling is the
 * middle's program, and the Bar shows its workspaces as a bar shows a
 * compositor's; where they stand is the look's `[bar]`, by their ids
 * (`widget-ids.ts`). Each is given the engine and the Projects, as every
 * widget is (decision 11): what it reads of the Tiling, it reads by
 * selector from what the Window keeps (`kept.ts`), and a click runs an
 * action by its id.
 */
import type { ProjectSummary } from "@banda/contract"
import type { Workspaces as Style } from "@banda/contract/look"
import { type Run, sameData, useRun } from "@banda/core/react"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { cn } from "@banda/ui/lib/utils"
import type { Widget, WidgetProps } from "@banda/ui/module"
import { PlusIcon } from "lucide-react"
import { useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react"
import { useLookBar } from "../look"
import { AsidePill } from "./AsidePill"
import { BarMotion } from "./bar-motion"
import { AsideContext, useTiled } from "./kept"
import { type InBar, inBar, type Workspaces } from "./model"
import { ASIDE, WORKSPACES } from "./widget-ids"

/** A workspace as the bar shows it: a Project's by its badge (ADR 0065,
 * decision 9). */
type BarWorkspace = InBar & { owner?: ProjectSummary }

/** What the numbers read of the workspaces: those the bar shows, and the
 * one on screen. Made afresh each time, it is told by `sameData`, so a
 * key that moves only the focus draws the numbers not. */
function barOf(state: Workspaces): {
  list: InBar[]
  current: number
} {
  return { list: inBar(state), current: state.current }
}

/** What a click on the workspace at `index` runs: on the one on screen,
 * the overview; on another, a go there by its place, as the keys of
 * `workspace.go-N` reach only the first nine. */
export function picked(run: Run, index: number, current: number): void {
  if (index === current) run("overview.toggle")
  else run("workspace.go", { index })
}

/** The workspaces the bar shows, a Project's by its Sign (ADR 0065,
 * decision 9), drawn again only as they change. */
function WorkspacesWidget({ projects }: WidgetProps) {
  const bar = useTiled(barOf, sameData)
  const run = useRun()
  const shown = useMemo(
    () =>
      bar.list.map((w) =>
        w.project
          ? {
              ...w,
              owner: projects.find((project) => project.id === w.project),
            }
          : w
      ),
    [bar, projects]
  )
  return (
    <WorkspaceList
      workspaces={shown}
      current={bar.current}
      onPick={(index) => picked(run, index, bar.current)}
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
      "The workspaces, as numbers or dots; click one to go there, or the one on screen for the overview.",
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

/** How wide a workspace is drawn in the bar, in rem: a number, the
 * mark's 1.5rem and a hair each side; a dot, long when shown. */
function widthOf(style: Style, here: boolean): number {
  if (style === "numbers") return 1.625
  return here ? 1.875 : 0.875
}

/**
 * The workspaces, as `[bar] workspaces` says: numbers, the one on screen
 * marked, or dots, the one on screen drawn long. They come, go and mark
 * the one on screen on the look's `workspace` move, with the screen.
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
  const style = useLookBar().workspaces
  const nav = useRef<HTMLElement>(null)
  const mark = useRef<HTMLSpanElement>(null)
  const motion = useRef<BarMotion>(null)
  motion.current ??= new BarMotion()
  const cells = workspaces.map((w) => ({
    id: w.id,
    width: widthOf(style, w.index === current),
  }))
  const at = workspaces.findIndex((w) => w.index === current)
  const left = cells.slice(0, at).reduce((sum, c) => sum + c.width, 0)
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
        hidden={style !== "numbers"}
        className="pointer-events-none absolute top-1/2 left-[0.0625rem] -mt-3 size-6 rounded-control bg-muted"
      />
      {workspaces.map((w) => {
        const here = w.index === current
        const number = String(w.index + 1)
        const name = w.bottom ? "New workspace" : `Workspace ${number}`
        // A Project's says whose it is when the pointer rests on it.
        const whose = w.owner ? `${w.owner.name}: ` : ""
        const dot = here
          ? "bg-foreground"
          : w.empty
            ? "ring-1 ring-muted-foreground/60 ring-inset"
            : "bg-muted-foreground/60"
        return (
          <button
            key={w.id}
            data-workspace={w.id}
            type="button"
            aria-current={here || undefined}
            aria-label={name}
            title={
              here
                ? `${whose}${keyFor("overview.toggle", "Overview")}`
                : w.bottom
                  ? name
                  : `${whose}${keyFor(`workspace.go-${number}`, name)}`
            }
            className="relative flex h-6 shrink-0 items-center justify-center overflow-hidden rounded-control text-xs text-muted-foreground tabular-nums outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current]:font-medium aria-[current]:text-foreground"
            onClick={() => onPick(w.index)}
          >
            {style === "dots" ? (
              <span
                className={cn(
                  "h-1.5 w-[calc(100%-0.5rem)] shrink-0 rounded-full",
                  dot
                )}
              />
            ) : w.bottom ? (
              <PlusIcon className="size-3.5 shrink-0" />
            ) : (
              <span
                className={cn(
                  "relative flex size-6 shrink-0 items-center justify-center rounded-control",
                  // Emptied: a free one goes once the Person leaves it; in
                  // the row and solo, a Project's keeps its place while its
                  // Project has Threads (ADR 0102, decision 2).
                  w.empty && "border border-dashed border-muted-foreground/50"
                )}
              >
                {/* A Project's workspace shows its Project (ADR 0065,
                    decision 9). */}
                {w.owner ? <ProjectSign project={w.owner} /> : number}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
