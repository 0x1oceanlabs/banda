import type { Status } from "@banda/contract"
import {
  BandaMark,
  loudest,
  MARK_WORDS,
  type MarkState,
} from "@banda/ui/components/banda-mark"
import { Button } from "@banda/ui/components/button"
import { Spinner } from "@banda/ui/components/spinner"
import { type Attention, QUIET } from "@banda/ui/pane"
import { TriangleAlertIcon } from "lucide-react"
import type { Problem } from "@banda/contract/look"
import { useLookProblems } from "../look"

/**
 * The bar across the window's top (ADR 0005, decision 9): the sidebar's
 * button on the left, which is Banda's mark and shows the loudest state of
 * the work, with how many things wait for the Person when more than one
 * does; then the workspaces' numbers. A click on another
 * number goes there; on the current one, opens the overview. More comes
 * later as small icons, once real use asks for them.
 */
export function Bar({
  status,
  attention = QUIET,
  numbers,
  current,
  sidebar,
  onSidebar,
  onPick,
}: {
  status: Status
  /** What the modules' work calls the Person for, for the mark to show. */
  attention?: Attention
  /** The workspaces it shows: those with Panes, and the current one. */
  numbers: number[]
  current: number
  sidebar: boolean
  onSidebar: () => void
  onPick: (index: number) => void
}) {
  const mark = loudest([attention.mark, markOf(status)])
  const { waiting } = attention
  const words =
    (mark === "rest" ? "" : ` · ${MARK_WORDS[mark]}`) +
    (waiting > 1 ? ` · ${waiting} wait for you` : "")
  return (
    <header className="flex h-(--bar-height) shrink-0 items-center gap-1 border-b px-1.5">
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
      <nav aria-label="Workspaces" className="flex items-center gap-0.5">
        {numbers.map((index) => {
          const here = index === current
          return (
            <button
              key={index}
              type="button"
              aria-current={here || undefined}
              title={
                here
                  ? "Overview (Alt+O)"
                  : `Workspace ${index + 1} (Alt+${index + 1})`
              }
              className="flex h-6 min-w-6 items-center justify-center rounded-md px-1.5 text-xs text-muted-foreground tabular-nums outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current]:bg-muted aria-[current]:font-medium aria-[current]:text-foreground"
              onClick={() => onPick(index)}
            >
              {index + 1}
            </button>
          )
        })}
      </nav>
      <div className="ml-auto flex items-center">
        <LookProblems />
        <Connection status={status} />
      </div>
    </header>
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
function LookProblems() {
  const problems = useLookProblems()
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
