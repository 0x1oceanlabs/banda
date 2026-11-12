import type { Engine, Status } from "@banda/contract"
import { Spinner } from "@banda/ui/components/spinner"
import { cn } from "@banda/ui/lib/utils"
import { TriangleAlertIcon } from "lucide-react"
import { useCallback, useMemo, useRef } from "react"
import type { Problem } from "@banda/contract/look"
import { useLookProblems } from "../look"
import { type Layout, written } from "./layout/arrange"
import { PARTS, type Part } from "./layout/placed"
import { layoutOf, useArranging } from "./layout/useArranging"
import type { Drawn } from "./layout/Widgets"
import { Mark } from "./mark/Mark"
import { UpdateWidget } from "./Update"
import { useStatus } from "@banda/ui/hooks/use-status"

/**
 * The Bar: the Window's line across its top, a program that holds other
 * programs (ADR 0024, ADR 0064, ADR 0087). It draws its own parts and
 * gives the rest of the line to the widgets, each a program of its own.
 *
 *   in    widgets   each part's widgets, drawn, as `[bar]` places them
 *                   (`layout/Widgets.tsx`, from the modules' `Widget`s)
 *         listed    `[bar]`'s lists, which a move rewrites
 *         problems  what the window finds wrong besides the look, as an id
 *                   in `[bar]` with no widget
 *         engine    this machine's engine: its connection and its updates
 *   draws <header>: the Mark at the left edge (`mark/`); the parts `left`, `center`
 *         (centred on the window) and `right`, each widget in a
 *         `data-widget` box; then the update, the look's problems and the
 *         engine's connection
 *   runs  nothing of its own: the Mark and each widget run theirs
 *   gives `onArrange` with `[bar]`'s new lists, once a widget moved with
 *         the mod is let go (`layout/useArranging.ts`)
 *
 * The Mark is a program of its own (`mark/Mark.tsx`), and so is each
 * widget. Where Banda draws the window's title bar, the Bar is it (ADR
 * 0030).
 */
export function Bar({
  engine,
  problems,
  widgets,
  listed,
  onArrange,
}: {
  /** This machine's engine: its connection, and its updates. */
  engine: Engine
  /** What the window finds wrong in the files besides, as in keys.toml. */
  problems: readonly Problem[]
  /** The widgets of each part, drawn. */
  widgets: Partial<Record<Part, readonly Drawn[]>>
  /** `[bar]`'s lists, which a widget moved with the mod rewrites. */
  listed?: Layout
  /** Writes `[bar]`'s lists once a widget moved with the mod. */
  onArrange?: (bar: Layout) => void
}) {
  const status = useStatus(engine)
  const nodes = useMemo(
    () =>
      new Map(
        PARTS.flatMap((part) =>
          (widgets[part] ?? []).map((one) => [one.id, one.node] as const)
        )
      ),
    [widgets]
  )
  const shown = useMemo(() => layoutOf(widgets), [widgets])
  const header = useRef<HTMLElement>(null)
  const write = useCallback(
    (after: Layout) => onArrange?.(written(listed ?? shown, shown, after)),
    [onArrange, listed, shown]
  )
  const { layout, dragging, over } = useArranging(header, shown, write)
  const zone = (part: Part) =>
    cn(
      "flex items-center rounded-control",
      dragging &&
        "min-h-7 min-w-10 bg-foreground/[0.03] ring-1 ring-foreground/15",
      over === part && "bg-foreground/[0.06] ring-ring"
    )
  const draw = (part: Part) =>
    layout[part].map((id) => (
      <div
        key={id}
        data-widget={id}
        className={cn(
          "flex items-center",
          dragging === id &&
            "relative z-10 cursor-grabbing rounded-control bg-popover shadow-lift ring-1 ring-ring/60"
        )}
      >
        {nodes.get(id)}
      </div>
    ))
  return (
    // Where Banda draws the window's title bar, as on macOS (ADR 0030),
    // the bar is it: the system's window buttons sit at its start, and its
    // empty space moves the window, as a title bar's does.
    <header
      ref={header}
      className={cn(
        "relative flex h-(--bar-height) shrink-0 items-center gap-1 border-b border-(--bar-rule) px-1.5 frame:ps-[calc(var(--frame-inset)+--spacing(1.5))] frame:[-webkit-app-region:drag] frame:*:[-webkit-app-region:no-drag]",
        dragging && "cursor-grabbing select-none"
      )}
    >
      {/* The Mark stays at the left edge, as the Apple menu does. */}
      <Mark engine={engine} />
      <div data-part="left" className={zone("left")}>
        {draw("left")}
      </div>
      <div
        data-part="center"
        className={cn(
          "absolute top-1/2 left-1/2 -translate-1/2",
          zone("center")
        )}
      >
        {draw("center")}
      </div>
      <div className="ml-auto flex items-center">
        <div data-part="right" className={zone("right")}>
          {draw("right")}
        </div>
        <UpdateWidget engine={engine} />
        <LookProblems more={problems} />
        <Connection status={status} />
      </div>
    </header>
  )
}

/** Says nothing while the engine answers; otherwise, what is going on. */
function Connection({ status }: { status: Status }) {
  if (status.state === "open") return null
  const words =
    status.state === "connecting"
      ? "Connecting…"
      : status.state === "refused"
        ? status.refusal.message
        : "Reconnecting…"
  return (
    <div
      role="status"
      className="flex items-center gap-2 px-2 text-meta text-muted-foreground"
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
      className="flex items-center gap-1 px-2 text-meta text-destructive"
    >
      <TriangleAlertIcon className="size-3.5" />
      {problems[0].path.split("/").at(-1)}
    </div>
  )
}
