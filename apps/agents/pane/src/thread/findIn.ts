/**
 * Find in the Thread, as T3 Code's Mod+F (ADR 0010, decision 9): which
 * lines hold the words, so a folded one opens to show them. Pure, so
 * plain tests cover it; the Pane marks the words themselves where they
 * show.
 */
import type { Item, Subagent, SubagentId } from "@banda/contract/agents"
import { wordsOf as laneWordsOf } from "./subagents"
import type { Line } from "./timeline"

/** The Thread's sub-agents, whose rows Find reads: by their ID, and the
 * model their Thread runs on, by its name, which a row names only when its
 * own is another. */
export type Lanes = {
  byId: ReadonlyMap<SubagentId, Subagent>
  model?: string
}

/** The words an item shows. */
function wordsOf({ body }: Item): string {
  switch (body.kind) {
    case "message":
    case "thought":
    case "notice":
      return body.text
    case "tool":
    case "question":
    case "visual":
      return body.title
    case "issue":
      return `${body.title}\n${body.body}`
    case "plan":
      return body.steps.map((step) => step.text).join("\n")
    case "moved":
      return ""
    // Find reads a sub-agent's record, not its anchor (ADR 0103, Open
    // questions): see `has`.
    case "subagent":
    case "crew":
      return ""
    case "messaged":
      return body.text ?? ""
  }
}

/** Each item's words in lower case: an item that does not change keeps
 * the same object, so only the one that grows is read again. */
const lowered = new WeakMap<Item, string>()

/** Each sub-agent's words in lower case, by its record, and the model
 * they were read beside: its anchor stays the same entry while it
 * changes, and a record that changes is a new object. */
const loweredLanes = new WeakMap<Subagent, { model?: string; words: string }>()

/** The words of the row sub-agent `lane` shows, in lower case. */
function laneWords(lane: Subagent, { byId, model }: Lanes): string {
  const was = loweredLanes.get(lane)
  if (was && was.model === model) return was.words
  const words = laneWordsOf(lane, [...byId.values()], model).toLocaleLowerCase()
  loweredLanes.set(lane, { model, words })
  return words
}

function has(item: Item, wanted: string, lanes: Lanes | undefined): boolean {
  if (item.body.kind === "subagent") {
    const lane = lanes?.byId.get(item.body.subagent)
    return lane !== undefined && laneWords(lane, lanes!).includes(wanted)
  }
  let words = lowered.get(item)
  if (words === undefined) {
    words = wordsOf(item).toLocaleLowerCase()
    lowered.set(item, words)
  }
  return words.includes(wanted)
}

/** Whether `line` holds `query`, in any case; nothing holds no words. A
 * sub-agent's row holds its label, role and how it ended, read from
 * `lanes`, the Thread's sub-agents. */
export function holds(line: Line, query: string, lanes?: Lanes): boolean {
  if (!query) return false
  const wanted = query.toLocaleLowerCase()
  switch (line.kind) {
    case "item":
    case "plan":
      return has(line.item, wanted, lanes)
    case "work":
    case "subagents":
      return line.items.some((item) => has(item, wanted, lanes))
    case "fold":
      return line.lines.some((inner) => holds(inner, query, lanes))
    default:
      return false
  }
}
