/** What a line of work and a fold share: one line that says what they did
 * and how much they changed, opening to their list (ADR 0058, decision
 * 4). */
import { Fragment, useState } from "react"
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@banda/ui/components/trace"
import type { Did, Line } from "../thread/timeline"
import { DiffCounts } from "@banda/ui/components/diff"
import type { LineFacts } from "./types"
import { key, LineOf } from "./index"

/** A line that folds `lines` under its `title`, open while it holds what
 * the Person looks for. */
export function Folded({
  icon,
  title,
  did,
  found,
  lines,
  facts,
}: {
  icon: React.ReactNode
  title: React.ReactNode
  did: Did
  found: boolean
  lines: Line[]
  facts: LineFacts
}) {
  const [open, setOpen] = useState(false)
  return (
    <Trace>
      <TraceCollapsible open={open || found} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>{icon}</TraceIcon>
            <TraceTitle>{title}</TraceTitle>
            <Counts did={did} />
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <List lines={lines} facts={facts} />
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

/** The lines a fold or a line of work opens to, one list: its calls and
 * thoughts close together, what it wrote or asked with room around. */
function List({ lines, facts }: { lines: Line[]; facts: LineFacts }) {
  return (
    <div className="flex flex-col gap-2 py-0.5">
      {lines.map((line) => (
        <div key={key(line)} className={room(line)}>
          <LineOf line={line} facts={facts} />
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
export function Kinds({
  did: { kinds },
  capital,
}: {
  did: Did
  capital?: boolean
}) {
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
