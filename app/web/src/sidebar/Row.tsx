import {
  BandaMark,
  MARK_WORDS,
  type MarkState,
  waits,
} from "@banda/ui/components/banda-mark"
import { HarnessLogo } from "@banda/ui/components/harness-logo"
import { ProjectBadge } from "@banda/ui/components/project-badge"
import { AlarmClockIcon } from "lucide-react"
import type { ReactNode } from "react"
import { ago, clock, left } from "@banda/ui/lib/words"
import { cn } from "@banda/ui/lib/utils"
import { useNow } from "@banda/ui/hooks/use-now"
import type { Listed } from "@banda/ui/pane"
import type { Row as Arranged } from "./arrange"
import type { Part, Settings } from "./settings"

/**
 * The built-in layouts (ADR 0008, decision 4). The line with the title is
 * always the mark and the title, so a Thread looks the same in every
 * density; the other lines add context.
 */
export const LAYOUTS: Readonly<Record<number, Part[][]>> = {
  1: [["mark", "title", "~", "project", "status"]],
  2: [
    ["mark", "project", "~", "status"],
    ["title", "~", "harness"],
  ],
  3: [["mark", "project", "~", "status"], ["title"], ["note", "~", "harness"]],
}

/** One row of the sidebar, its parts laid out as the settings say. */
export function Row({
  row,
  settings,
  inProject,
  current,
  onOpen,
  action,
}: {
  row: Arranged
  settings: Settings
  /** It sits under its Project's header, which already names the Project. */
  inProject: boolean
  current: boolean
  onOpen: () => void
  /** A button that shows while the pointer is over the row: its snooze's
   * clock, or Wake (ADR 0074). */
  action?: ReactNode
}) {
  const { lines, hide, layout } = settings.row
  const parts = (layout ?? LAYOUTS[lines] ?? LAYOUTS[3]).map((line) =>
    line.filter(
      (part) => !hide.includes(part) && !(part === "project" && inProject)
    )
  )
  const one = parts.length === 1
  const button = (
    <button
      type="button"
      aria-current={current ? "true" : undefined}
      className={cn(
        "flex w-full min-w-0 flex-col gap-0.5 rounded-lg border border-transparent px-2 text-left transition-colors outline-none",
        "hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50",
        one ? "py-1" : "py-1.5",
        current && "border-border bg-tile shadow-xs hover:bg-tile"
      )}
      onClick={onOpen}
    >
      {parts.map(
        (line, index) =>
          line.length > 0 && (
            <span key={index} className="flex min-w-0 items-center gap-1.5">
              {line.map((part, at) => (
                <Piece key={`${part}${at}`} part={part} row={row} wide={!one} />
              ))}
            </span>
          )
      )}
    </button>
  )
  if (!action) return button
  return (
    <div data-row className="group/row relative">
      {button}
      <span className="absolute top-1 right-1 hidden items-center rounded-md bg-popover shadow-xs ring-1 ring-foreground/10 group-focus-within/row:flex group-hover/row:flex pointer-coarse:flex">
        {action}
      </span>
    </div>
  )
}

function Piece({
  part,
  row,
  wide,
}: {
  part: Part
  row: Arranged
  wide: boolean
}) {
  const { listed, project } = row
  // Nothing waits in it and nothing works: it steps back.
  const quiet =
    row.state === "archived" ||
    row.state === "snoozed" ||
    (row.state === "active" && !waits(listed.mark) && row.woke === undefined)
  switch (part) {
    case "~":
      return <span className="ml-auto" />
    case "mark":
      return (
        <ThreadMark listed={listed} className={cn(quiet && "opacity-40")} />
      )
    case "title":
      return (
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm",
            quiet ? "text-foreground/75" : "text-foreground"
          )}
        >
          {listed.title}
        </span>
      )
    case "project":
      // The mark stands where the Project's badge was: a row with room names
      // the Project; a row of one line shows its badge.
      return wide ? (
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {project.name}
        </span>
      ) : (
        <ProjectBadge project={project} />
      )
    case "harness": {
      // Claude's or Codex's logo, as T3 Code shows them; another Harness
      // by its name.
      const name = listed.by ?? listed.harness
      return name ? <HarnessLogo id={listed.harness} name={name} /> : null
    }
    case "status":
      if (row.state === "snoozed") return <Sleeps listed={listed} />
      if (row.woke !== undefined) return <Woke listed={listed} at={row.woke} />
      return <Status listed={listed} />
    case "note": {
      const text = listed.calls ?? listed.said
      if (!text) return <span className="min-w-0 flex-1" />
      return (
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs",
            listed.calls && listed.mark === "asking"
              ? "text-attention"
              : listed.calls
                ? "text-destructive"
                : "text-muted-foreground"
          )}
        >
          {text}
        </span>
      )
    }
  }
}

/**
 * What calls the Person, in its colour; the running turn's timer; or how
 * long ago it last changed.
 */
export function Status({ listed }: { listed: Listed }) {
  const { mark, changed, began } = listed
  switch (mark) {
    case "asking":
      return <Word className="text-attention">{MARK_WORDS.asking}</Word>
    case "failed":
    case "offline":
      return <Word className="text-destructive">{MARK_WORDS[mark]}</Word>
    case "done":
      return <Word className="text-foreground">{MARK_WORDS.done}</Word>
    case "running":
    case "thinking":
      return began === undefined ? null : <Timer from={began} />
    default:
      return (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {ago(changed)}
        </span>
      )
  }
}

/** When a snoozed Thread wakes, and how long is left: "22:40 · 1h",
 * "Fri 09:00 · 12h", or "when done" (ADR 0074, decision 6). */
function Sleeps({ listed }: { listed: Listed }) {
  const now = useNow(15_000)
  const until = listed.snooze?.until
  const by = listed.snooze?.byAgent ? "Snoozed by its Agent" : "Snoozed"
  return (
    <span
      className="shrink-0 text-xs text-muted-foreground tabular-nums"
      title={until === undefined ? `${by} until it is done` : by}
    >
      {until === undefined
        ? "when done"
        : `${clock(until, now)} · ${left(until, now)}`}
    </span>
  )
}

/** A Thread that woke while its Person was away: a clock before what calls,
 * or before the time it woke. */
function Woke({ listed, at }: { listed: Listed; at: number }) {
  const calls = waits(listed.mark) && listed.mark !== "offline"
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 text-xs font-medium tabular-nums",
        toneOf(listed.mark) ?? "text-foreground"
      )}
      title="Woke from its snooze"
    >
      <AlarmClockIcon className="size-3" aria-label="Woke" />
      {calls ? MARK_WORDS[listed.mark] : clock(at)}
    </span>
  )
}

function Word({
  className,
  children,
}: {
  className: string
  children: string
}) {
  return (
    <span className={cn("shrink-0 text-xs font-medium", className)}>
      {children}
    </span>
  )
}

/** How long the work that runs now has run, ticking each second. */
function Timer({ from }: { from: number }) {
  const now = useNow(1000)
  return (
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
      {elapsed(now - from)}
    </span>
  )
}

/** `0:41`, `7:05`, `1:02:09`. */
export function elapsed(ms: number): string {
  const all = Math.max(0, Math.floor(ms / 1000))
  const [h, m, s] = [
    Math.floor(all / 3600),
    Math.floor(all / 60) % 60,
    all % 60,
  ]
  const two = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/** The colour a mark calls in: a question's, a failure's, done's green. */
export function toneOf(mark: MarkState): string | undefined {
  if (mark === "asking") return "text-attention"
  if (mark === "failed" || mark === "offline") return "text-destructive"
  if (mark === "done") return "text-added"
  return undefined
}

/** A Thread's mark, as the sidebar and the Banda menu show it, in its
 * colour. */
export function ThreadMark({
  listed,
  news,
  className,
}: {
  listed: Listed
  /** As `BandaMark`'s. */
  news?: boolean
  className?: string
}) {
  return (
    <BandaMark
      variant="agent"
      state={listed.mark}
      playful={0}
      news={news}
      label={MARK_WORDS[listed.mark]}
      className={cn("size-4 shrink-0", toneOf(listed.mark), className)}
    />
  )
}
