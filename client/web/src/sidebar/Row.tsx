import {
  MARK_WORDS,
  ThreadMark,
  toneOf,
  waits,
} from "@banda/ui/components/banda-mark"
import type { Named } from "@banda/contract/machines"
import { Emblem, emblemOf, type EmblemOf } from "@banda/ui/components/emblem"
import { MachineMark } from "@banda/ui/components/machine-icon"
import { ProjectName, ProjectSign } from "@banda/ui/components/project-sign"
import { AlarmClockIcon } from "lucide-react"
import { Fragment, type ReactNode } from "react"
import { ago, clock, left } from "@banda/ui/lib/words"
import { cn } from "@banda/ui/lib/utils"
import { useNow } from "@banda/ui/hooks/use-now"
import type { Listed } from "@banda/ui/pane"
import type { Row as Arranged } from "./arrange"
import { MachineCard } from "./MachineCard"
import { useOpenRow } from "./open"
import type { Part, Settings } from "./settings"
import { THINKING, useThinking } from "@banda/ui/lib/naming"

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

const NO_HARNESSES: readonly EmblemOf[] = []

/** What a row draws: its parts, and another machine's mark where its
 * Project is hidden. */
type Drawn = Part | "machine"

/** One row of the sidebar, its parts laid out as the settings say; a
 * click opens the Pane it stands for, by `pane.pick`. */
export function Row({
  row,
  settings,
  inProject,
  current,
  action,
  field,
  machine,
  stillAt,
  harnesses = NO_HARNESSES,
}: {
  row: Arranged
  settings: Settings
  /** It sits under its Project's header, which already names the Project. */
  inProject: boolean
  current: boolean
  /** A button that shows while the pointer is over the row: its snooze's
   * clock, or Wake (ADR 0074). */
  action?: ReactNode
  /** The field that names it, in its title's place (ADR 0077): the row
   * is then no button. */
  field?: ReactNode
  /** The other machine its Agent works on, after its Project, where no
   * label above names it (ADR 0095, decision 5); this machine never. */
  machine?: Named
  /** When its host went away: its timer stands as it was then. */
  stillAt?: number
  /** The Harness list its emblem is read from; none, the Harness's own. */
  harnesses?: readonly EmblemOf[]
}) {
  const { lines, hide, layout } = settings.row
  const onOpen = useOpenRow(row)
  const parts = (layout ?? LAYOUTS[lines] ?? LAYOUTS[3]).map((line) =>
    line.flatMap((part): Drawn[] => {
      if (part === "project" && inProject) return []
      // A row that hides its Project still says where its Thread runs.
      if (hide.includes(part))
        return part === "project" && machine ? ["machine"] : []
      return [part]
    })
  )
  const one = parts.length === 1
  const Element = field ? "div" : "button"
  const button = (
    <Element
      type={field ? undefined : "button"}
      aria-current={current ? "true" : undefined}
      className={cn(
        "flex w-full min-w-0 flex-col gap-0.5 rounded-lg border border-transparent px-2 text-left transition-colors outline-none",
        "hover:bg-foreground/5 focus-visible:ring-3 focus-visible:ring-ring/50",
        one ? "py-1" : "py-1.5",
        current && "border-border bg-tile shadow-xs hover:bg-tile"
      )}
      onClick={field ? undefined : onOpen}
    >
      {parts.map(
        (line, index) =>
          line.length > 0 && (
            <span key={index} className="flex min-w-0 items-center gap-1.5">
              {line.map((part, at) =>
                part === "title" && field ? (
                  <Fragment key={`${part}${at}`}>{field}</Fragment>
                ) : (
                  <Piece
                    key={`${part}${at}`}
                    part={part}
                    row={row}
                    wide={!one}
                    machine={machine}
                    stillAt={stillAt}
                    harnesses={harnesses}
                  />
                )
              )}
            </span>
          )
      )}
    </Element>
  )
  if (!action || field) return button
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
  machine,
  stillAt,
  harnesses,
}: {
  part: Drawn
  row: Arranged
  wide: boolean
  machine?: Named
  stillAt?: number
  harnesses: readonly EmblemOf[]
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
      return <Title row={row} quiet={quiet} />
    case "project":
      // A row with room shows the Project's sign and name; a row of one
      // line, its sign (ADR 0070, decision 5). Another machine's, then
      // that machine.
      return (
        <>
          {wide ? (
            <ProjectName
              project={project}
              className="text-xs text-muted-foreground"
            />
          ) : (
            <ProjectSign project={project} size={14} />
          )}
          <Machine machine={machine} host={row.host} wide={wide} />
        </>
      )
    case "machine":
      return <Machine machine={machine} host={row.host} wide={wide} />
    case "harness": {
      // Its account's emblem, and in a row of more lines its name (ADR
      // 0093, decision 1).
      const name = listed.by ?? listed.harness
      if (!listed.harness || !name) return null
      return (
        <Emblem
          of={emblemOf(harnesses, listed.harness, name)}
          named={wide}
          nameClassName="max-w-28 text-xs text-muted-foreground"
        />
      )
    }
    case "status":
      if (row.state === "snoozed") return <Sleeps listed={listed} />
      if (row.woke !== undefined) return <Woke listed={listed} at={row.woke} />
      return <Status listed={listed} stillAt={stillAt} />
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

/** Another machine on a row (ADR 0095, decision 5): its icon and name,
 * small and muted, with no border; its icon alone on a row of one line.
 * Its card, as the pointer rests on it, says the rest, so it has no
 * tooltip. */
function Machine({
  machine,
  host,
  wide,
}: {
  machine?: Named
  host?: string
  wide: boolean
}) {
  if (!machine || host === undefined) return null
  return (
    <MachineCard host={host} className="flex shrink-0">
      <MachineMark named={machine} form={wide ? "compact" : "icon"} title="" />
    </MachineCard>
  )
}

/** The row's title; while a model writes one, it shimmers (ADR 0077,
 * decision 3). */
function Title({ row, quiet }: { row: Arranged; quiet: boolean }) {
  const thinking = useThinking(row.project.id, row.listed.id)
  return (
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-sm",
        quiet ? "text-foreground/75" : "text-foreground"
      )}
    >
      <span data-shimmer={thinking || undefined}>
        {thinking ? THINKING : row.listed.title}
      </span>
    </span>
  )
}

/**
 * What calls the Person, in its colour; the running turn's timer, which
 * stands at `stillAt` when it is given; or how long ago it last changed.
 */
export function Status({
  listed,
  stillAt,
}: {
  listed: Listed
  stillAt?: number
}) {
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
      return began === undefined ? null : (
        <Timer from={began} stillAt={stillAt} />
      )
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
      title={until === undefined ? `${by} until it's done` : by}
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

/** How long the work that runs now has run, ticking each second, or
 * until `stillAt`, standing. */
function Timer({ from, stillAt }: { from: number; stillAt?: number }) {
  const now = useNow(1000, stillAt === undefined)
  return (
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
      {elapsed((stillAt ?? now) - from)}
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
