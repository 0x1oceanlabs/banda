/**
 * The lines the timeline adds between a Thread's entries, one view for
 * each kind (ADR 0091, decision 3). A new kind of line does not compile
 * until it has a row here.
 */
import { ChangesLine } from "./changes"
import { EndedLine } from "./ended"
import { EntryLine } from "./entry"
import { FoldLine } from "./fold"
import { ProposedPlanLine } from "./proposed-plan"
import { SubagentsLine } from "./subagents"
import type { LineFacts, LineView } from "./types"
import { WorkingLine } from "./working"
import { WorkLine } from "./work"
import type { Line } from "../thread/timeline"

const VIEWS: { [K in Line["kind"]]: LineView<K> } = {
  item: EntryLine,
  work: WorkLine,
  subagents: SubagentsLine,
  fold: FoldLine,
  working: WorkingLine,
  plan: ProposedPlanLine,
  changes: ChangesLine,
  ended: EndedLine,
}

/** One line, drawn by its kind. */
export function LineOf({ line, facts }: { line: Line; facts: LineFacts }) {
  const View = VIEWS[line.kind] as LineView<Line["kind"]>
  return <View line={line} facts={facts} />
}

/** A line's key among its siblings. */
export function key(line: Line): string {
  switch (line.kind) {
    case "item":
    case "plan":
      return line.item.id
    case "work":
    case "subagents":
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
