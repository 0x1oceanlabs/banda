import { useState } from "react"
import type { Item, TurnView } from "@bandaso/contract/agents"
import { Spinner } from "@bandaso/ui/components/spinner"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@bandaso/ui/components/trace"
import { useNow } from "@bandaso/ui/hooks/use-now"
import { CircleCheckIcon, CircleSlashIcon, LayersIcon } from "lucide-react"
import { duration, foldTitle, type Line, summary } from "./timeline"

/** How a line shows inside a line of work or a fold: as the Thread does. */
type Render = (line: Line) => React.ReactNode

/**
 * Tool calls and thoughts in a row, as one line that names what they did
 * (ADR 0010, decision 1). While they are the end of the turn that runs, the
 * line shows the latest of them instead. Opened, it lists them all, each
 * opening on its own.
 */
export function WorkLine({
  items,
  live,
  found,
  render,
}: {
  items: Item[]
  live: boolean
  /** It holds what the Person looks for, so it shows open. */
  found: boolean
  render: Render
}) {
  const [open, setOpen] = useState(false)
  const latest = items.at(-1)?.body
  const title = !live
    ? summary(items)
    : latest?.kind === "tool"
      ? latest.title
      : "Thinking"
  return (
    <Trace>
      <TraceCollapsible open={open || found} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={live ? "running" : undefined}>
            <TraceIcon>
              <LayersIcon />
            </TraceIcon>
            <TraceTitle>{title}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div className="flex max-h-[min(18rem,50dvh)] flex-col gap-2 overflow-y-auto border-l py-1 pl-3">
            {items.map((item) => (
              <div key={item.id}>{render({ kind: "item", item })}</div>
            ))}
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

/** What a turn that ended did before its last reply, folded behind how
 * long it took. */
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
  return (
    <Trace>
      <TraceCollapsible open={open || found} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <Icon />
            </TraceIcon>
            <TraceTitle>{foldTitle(turn)}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div className="flex flex-col gap-4 pt-2">
            {lines.map((line) => (
              <div key={key(line)}>{render(line)}</div>
            ))}
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

/** The turn that runs, and how long it has: "Working for 12s". */
export function Working({ turn, name }: { turn: TurnView; name: string }) {
  const now = useNow(1000, turn.started !== undefined)
  const title =
    turn.started === undefined
      ? `${name} is working…`
      : `Working for ${duration(now - turn.started)}`
  return (
    <Trace>
      <TraceLine status="running">
        <TraceIcon>
          <Spinner />
        </TraceIcon>
        <TraceTitle className="tabular-nums">{title}</TraceTitle>
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
