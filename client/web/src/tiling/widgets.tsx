/**
 * The Tiling's widgets on the Bar (ADR 0087, decision 5): the workspaces,
 * as numbers or dots, with the Group map of the one on screen beside them,
 * and the pill that says the workspaces are set aside. The Tiling is the
 * middle's program, and the Bar shows its workspaces as a bar shows a
 * compositor's; where they stand is the look's `[bar]`, by their ids
 * (`widget-ids.ts`). What they read of the Tiling, the Window hands them
 * (`TilingBar`): the workspaces, which are the Tiling's own to change, and
 * the aside apart, so a key that moves the workspaces draws the pill not.
 */
import type { Aside } from "@banda/contract/workspaces"
import type { Workspaces as Style } from "@banda/contract/look"
import type { ProjectSummary } from "@banda/contract"
import { ProjectSign } from "@banda/ui/components/project-sign"
import { useKeyLabel } from "@banda/ui/hooks/use-key-of"
import { useRun } from "@banda/ui/hooks/use-run"
import { cn } from "@banda/ui/lib/utils"
import type { Widget, WidgetProps } from "@banda/ui/module"
import { PlusIcon } from "lucide-react"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react"
import { useCalling } from "../calls/stores"
import { useLookBar } from "../look"
import { AsidePill } from "../safe/AsidePill"
import type { Change } from "./arrange"
import { BarMotion } from "./bar-motion"
import { WorkspaceMap } from "./Map"
import { current, go, type InBar, inBar, type Workspaces } from "./model"
import type { Shows } from "./shows"
import { ASIDE, WORKSPACES } from "./widget-ids"

/** What the workspaces' widget reads of the Tiling: the workspaces as it
 * drew them, what the Apps list of their Panes, and how it changes them. */
type Tiled = {
  workspaces: Workspaces
  shows: Shows
  change: (how: Change) => Promise<void>
}

const TiledContext = createContext<Tiled | null>(null)
const AsideContext = createContext<Aside | null>(null)

/** Hands the Tiling's widgets what they read of it: the Window gives it
 * around its Bar. */
export function TilingBar({
  workspaces,
  shows,
  change,
  aside,
  children,
}: Tiled & { aside: Aside | null; children: ReactNode }) {
  const tiled = useMemo(
    () => ({ workspaces, shows, change }),
    [workspaces, shows, change]
  )
  return (
    <TiledContext value={tiled}>
      <AsideContext value={aside}>{children}</AsideContext>
    </TiledContext>
  )
}

/** A workspace as the bar shows it: a Project's by its badge (ADR 0065,
 * decision 9). */
type BarWorkspace = InBar & { owner?: ProjectSummary }

/**
 * The workspaces and the Group map of the one on screen. A click on
 * another goes there, by the Tiling's own change, as `workspace.go-N`
 * reaches only the first nine; on the one on screen, it opens the
 * overview.
 */
function WorkspacesWidget({ projects }: WidgetProps) {
  const tiled = useContext(TiledContext)
  const run = useRun()
  // A Project's by its name (ADR 0065, decision 9).
  const shown = useMemo(
    () =>
      tiled
        ? inBar(tiled.workspaces).map((w) =>
            w.project
              ? {
                  ...w,
                  owner: projects.find((project) => project.id === w.project),
                }
              : w
          )
        : [],
    [tiled, projects]
  )
  if (!tiled) return null
  const { workspaces, shows, change } = tiled
  return (
    <>
      <WorkspaceList
        workspaces={shown}
        current={workspaces.current}
        onPick={(index) =>
          index === workspaces.current
            ? run("overview.toggle")
            : void change((w) => go(w, index))
        }
      />
      <WorkspaceMap workspace={current(workspaces)} shows={shows} />
    </>
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
      "The workspaces, as numbers or dots, and the one on screen's Groups; click one to go there, or the one on screen for the overview.",
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
 * the one on screen on the look's `workspace` move, with the screen. A
 * Project's has a dot while one of its Threads calls, which it reads from
 * the Window's stores (ADR 0065, decision 9).
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
  const calling = useCalling()
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
        className="pointer-events-none absolute top-1/2 left-[0.0625rem] -mt-3 size-6 rounded-md bg-muted"
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
            className="relative flex h-6 shrink-0 items-center justify-center overflow-hidden rounded-md text-xs text-muted-foreground tabular-nums outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current]:font-medium aria-[current]:text-foreground"
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
                  "relative flex size-6 shrink-0 items-center justify-center rounded-md",
                  // Emptied, it goes once the Person leaves it.
                  w.empty && "border border-dashed border-muted-foreground/50"
                )}
              >
                {/* A Project's workspace shows its Project, with a dot while
                    one of its Threads calls (ADR 0065, decision 9). */}
                {w.owner ? <ProjectSign project={w.owner} /> : number}
                {w.project && calling.includes(w.project) && (
                  <span
                    aria-hidden
                    className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-attention"
                  />
                )}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
