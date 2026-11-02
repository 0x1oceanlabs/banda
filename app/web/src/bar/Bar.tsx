import type { Status } from "@banda/contract"
import {
  BandaMark,
  loudest,
  MARK_WORDS,
  type MarkState,
} from "@banda/ui/components/banda-mark"
import { Button } from "@banda/ui/components/button"
import { Spinner } from "@banda/ui/components/spinner"
import { cn } from "@banda/ui/lib/utils"
import { type Attention, QUIET } from "@banda/ui/pane"
import { PlusIcon, TriangleAlertIcon } from "lucide-react"
import { useEffect, useLayoutEffect, useRef } from "react"
import type { Problem, Workspaces } from "@banda/contract/look"
import { useLookBar, useLookProblems } from "../look"
import type { InBar } from "../workspaces/model"
import { BarMotion } from "./motion"

/**
 * The bar across the window's top (ADR 0005, decision 9): the sidebar's
 * button on the left, which is Banda's mark and shows the loudest state of
 * the work, with how many things wait for the Person when more than one
 * does; then the workspaces, as numbers or dots, and the empty one at the
 * bottom as a `+`. A click on another goes there; on the current one,
 * opens the overview. More comes later as small icons, once real use asks
 * for them.
 */
export function Bar({
  status,
  attention = QUIET,
  workspaces,
  current,
  sidebar,
  onSidebar,
  onPick,
  problems,
}: {
  status: Status
  /** What the modules' work calls the Person for, for the mark to show. */
  attention?: Attention
  /** The workspaces it shows: those with Panes, the current one, and the
   * empty one at the bottom. */
  workspaces: readonly InBar[]
  current: number
  sidebar: boolean
  onSidebar: () => void
  onPick: (index: number) => void
  /** What the window finds wrong in the files besides, as in keys.toml. */
  problems: readonly Problem[]
}) {
  const mark = loudest([attention.mark, markOf(status)])
  const { waiting } = attention
  const words =
    (mark === "rest" ? "" : ` · ${MARK_WORDS[mark]}`) +
    (waiting > 1 ? ` · ${waiting} wait for you` : "")
  return (
    <header className="flex h-(--bar-height) shrink-0 items-center gap-1 border-b border-(--bar-rule) px-1.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Sidebar${words}`}
        aria-pressed={sidebar}
        title={`Sidebar (Alt+A)${words}`}
        className="relative"
        onClick={onSidebar}
      >
        <BandaMark state={mark} className="size-5" />
        {waiting > 1 && (
          <span
            aria-hidden
            className="absolute -right-0.5 -bottom-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-attention px-0.5 text-[9px] leading-none font-semibold text-white tabular-nums"
          >
            {waiting > 9 ? "9+" : waiting}
          </span>
        )}
      </Button>
      <WorkspaceList
        workspaces={workspaces}
        current={current}
        onPick={onPick}
      />
      <div className="ml-auto flex items-center">
        <LookProblems more={problems} />
        <Connection status={status} />
      </div>
    </header>
  )
}

/** How wide a workspace is drawn in the bar, in rem: a number, the
 * mark's 1.5rem and a hair each side; a dot, long when shown. */
function widthOf(style: Workspaces, here: boolean): number {
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
  workspaces: readonly InBar[]
  current: number
  onPick: (index: number) => void
}) {
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
        className="pointer-events-none absolute top-1/2 left-[0.0625rem] -mt-3 size-6 rounded-md bg-muted"
      />
      {workspaces.map((w) => {
        const here = w.index === current
        const number = String(w.index + 1)
        const name = w.bottom ? "New workspace" : `Workspace ${number}`
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
                ? "Overview (Alt+O)"
                : w.bottom
                  ? name
                  : `${name} (Alt+${number})`
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
                  "flex size-6 shrink-0 items-center justify-center rounded-md",
                  // Emptied, it goes once the Person leaves it.
                  w.empty && "border border-dashed border-muted-foreground/50"
                )}
              >
                {number}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

/** The mark sleeps while the engine does not answer, and fails if it refused. */
function markOf(status: Status): MarkState {
  if (status.state === "open") return "rest"
  return status.state === "refused" ? "failed" : "offline"
}

/** Says nothing while the engine answers; otherwise, what is going on. */
function Connection({ status }: { status: Status }) {
  if (status.state === "open") return null
  const words =
    status.state === "connecting"
      ? "Connecting…"
      : status.state === "lost"
        ? "Reconnecting…"
        : status.refusal.message
  return (
    <div
      role="status"
      className="flex items-center gap-2 px-2 text-xs text-muted-foreground"
    >
      {status.state === "refused" ? (
        <span className="size-2 rounded-full bg-destructive" />
      ) : (
        <Spinner className="size-3" />
      )}
      {words}
    </div>
  )
}

/** Where a file of the look is wrong, as compilers say it. */
export function problemWords(problem: Problem): string {
  const at =
    problem.line != null ? `:${problem.line}:${problem.column ?? 1}` : ""
  return `${problem.path}${at}: ${problem.message}`
}

/**
 * Says when a file of the look is wrong (ADR 0005, decision 11): the last
 * good look stays, and this names the file and the line.
 * `banda look check` says the same in a terminal.
 */
function LookProblems({ more }: { more: readonly Problem[] }) {
  const problems = [...useLookProblems(), ...more]
  if (problems.length === 0) return null
  const words = problems.map(problemWords).join("\n")
  return (
    <div
      role="status"
      aria-label={`The look: ${words}`}
      title={`The look keeps its last good state:\n${words}`}
      className="flex items-center gap-1 px-2 text-xs text-destructive"
    >
      <TriangleAlertIcon className="size-3.5" />
      {problems[0].path.split("/").at(-1)}
    </div>
  )
}
