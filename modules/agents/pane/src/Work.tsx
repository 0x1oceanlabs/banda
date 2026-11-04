import { Fragment, useState } from "react"
import type { Item, TurnState, TurnView } from "@banda/contract/agents"
import { DiffCounts } from "@banda/ui/components/diff"
import { Spinner } from "@banda/ui/components/spinner"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import { useNow } from "@banda/ui/hooks/use-now"
import { CircleCheckIcon, CircleSlashIcon, LayersIcon } from "lucide-react"
import { duration } from "@banda/ui/lib/words"
import {
  type Did,
  did,
  type Doing,
  foldTitle,
  type Line,
  workOf,
} from "./timeline"

/** How a line shows inside a line of work or a fold: as the Thread does. */
type Render = (line: Line) => React.ReactNode

/**
 * Tool calls and thoughts in a row, as one line that says what they did
 * (ADR 0058, decision 4): "Ran 3 commands (1 failed), edited 2 files +38
 * −9". Opened, it lists them under one rule, each opening on its own.
 */
export function WorkLine({
  items,
  turn,
  found,
  render,
}: {
  items: Item[]
  /** How their turn stands, if known. */
  turn?: TurnState
  /** It holds what the Person looks for, so it shows open. */
  found: boolean
  render: Render
}) {
  const [open, setOpen] = useState(false)
  const done = did(items, turn)
  return (
    <Trace>
      <TraceCollapsible open={open || found} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <LayersIcon />
            </TraceIcon>
            <TraceTitle>
              {done.kinds.length > 0 ? (
                <Kinds did={done} capital />
              ) : turn === "running" ? (
                "Working"
              ) : (
                "Worked"
              )}
            </TraceTitle>
            <Counts did={done} />
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <List lines={items.map((item) => ({ kind: "item", item }))}>
            {render}
          </List>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

/** What a turn that ended did before its last reply, folded into one
 * line: how long it took, what it did and how much it changed. */
export function Fold({
  turn,
  lines,
  found,
  render,
}: {
  turn: TurnView
  lines: Line[]
  /** It holds what the Person looks for, so it shows open. */
  found: boolean
  render: Render
}) {
  const [open, setOpen] = useState(false)
  const Icon = turn.state === "stopped" ? CircleSlashIcon : CircleCheckIcon
  const done = did(workOf(lines), turn.state)
  return (
    <Trace>
      <TraceCollapsible open={open || found} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <Icon />
            </TraceIcon>
            <TraceTitle>
              {foldTitle(turn)}
              {done.kinds.length > 0 && (
                <>
                  {" · "}
                  <Kinds did={done} />
                </>
              )}
            </TraceTitle>
            <Counts did={done} />
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <List lines={lines}>{render}</List>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

/** The lines a fold or a line of work opens to, one list: its calls and
 * thoughts close together, what it wrote or asked with room around. */
function List({
  lines,
  children: render,
}: {
  lines: Line[]
  children: Render
}) {
  return (
    <div className="flex flex-col gap-2 py-0.5">
      {lines.map((line) => (
        <div key={key(line)} className={room(line)}>
          {render(line)}
        </div>
      ))}
    </div>
  )
}

/** The room a line of a list takes around it, beyond the list's own gap.
 * A message keeps room under it for its actions, which show over it. */
function room(line: Line): string | undefined {
  if (line.kind !== "item") return "my-2"
  switch (line.item.body.kind) {
    case "tool":
    case "thought":
    case "notice":
      return undefined
    case "message":
      return "mt-2 mb-4"
    default:
      return "my-2"
  }
}

/** "ran 3 commands (1 failed), edited 2 files": what failed in the
 * destructive colour. */
function Kinds({ did: { kinds }, capital }: { did: Did; capital?: boolean }) {
  return kinds.map(({ words, failed }, at) => (
    <Fragment key={at}>
      {at > 0 && ", "}
      {capital && at === 0 ? words[0].toUpperCase() + words.slice(1) : words}
      {failed > 0 && (
        <>
          {" "}
          <span className="text-destructive">({failed} failed)</span>
        </>
      )}
    </Fragment>
  ))
}

/** The lines a run of work added and removed, if it changed any. */
function Counts({ did: { added, removed } }: { did: Did }) {
  return added + removed > 0 ? (
    <DiffCounts added={added} removed={removed} />
  ) : null
}

/**
 * The turn that runs, at its live edge (ADR 0058, decision 5): how long it
 * has worked, "Working for 45s", and what it does now: "· Running pnpm
 * test · 11s", or "· Waiting for you".
 */
export function Working({
  turn,
  name,
  doing,
}: {
  turn: TurnView
  name: string
  doing?: Doing
}) {
  const since = doing?.kind === "calling" ? doing.since : undefined
  const now = useNow(1000, turn.started !== undefined || since !== undefined)
  const title =
    turn.started === undefined
      ? `${name} is working…`
      : `Working for ${duration(now - turn.started)}`
  return (
    <Trace>
      <TraceLine status="running">
        <TraceIcon>
          <Spinner className="motion-reduce:animate-none" />
        </TraceIcon>
        <TraceTitle className="shrink-0 tabular-nums">{title}</TraceTitle>
        {doing && (
          <span className="min-w-0 truncate text-muted-foreground/70 tabular-nums">
            {"· "}
            {doing.kind === "asking" ? (
              "Waiting for you"
            ) : doing.kind === "thinking" ? (
              "Thinking"
            ) : (
              <>
                {[doing.said.verb, doing.said.subject]
                  .filter(Boolean)
                  .join(" ")}
                {` · ${duration(now - doing.since)}`}
              </>
            )}
          </span>
        )}
      </TraceLine>
    </Trace>
  )
}

/** A line's key among its siblings. */
export function key(line: Line): string {
  switch (line.kind) {
    case "item":
    case "plan":
      return line.item.id
    case "work":
    case "fold":
      return line.id
    case "working":
      return `working-${line.turn.id}`
    case "changes":
      return `changes-${line.turn.id}`
    case "ended":
      return `ended-${line.turn.id}`
  }
}
