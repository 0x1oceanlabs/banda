/**
 * The Thread's lines as T3 Code shows them (ADR 0010, decision 1): the
 * Agent's tool calls and thoughts in a row are one line of work, a turn
 * that ended folds its work away behind how long it took, and the turn that
 * runs says how long it has. Pure, so plain tests cover it.
 */
import type { Item, ToolKind, TurnView } from "@banda/contract/agents"
import { changes, type FileChange } from "./changes"
import {
  isReply,
  planOf,
  type Row,
  rows,
  running,
  type Said,
  type ThreadState,
} from "./thread"

export type Line =
  | Row
  /** Two or more tool calls and thoughts in a row, from one turn. `live`
   * while they are the end of the turn that runs. */
  | { kind: "work"; id: string; turn?: string; items: Item[]; live: boolean }
  /** What a turn that ended did before its last reply. */
  | { kind: "fold"; id: string; turn: TurnView; lines: Line[] }
  /** The turn that runs, where its work starts. */
  | { kind: "working"; turn: TurnView }
  /** The reply a turn in plan mode ended with: the plan it proposed. */
  | { kind: "plan"; turn: TurnView; item: Said }
  /** The files a turn that ended changed, after what it wrote. */
  | { kind: "changes"; turn: TurnView; files: FileChange[] }

/** The Thread's lines, from the rows {@link rows} gives. */
export function timeline(state: ThreadState): Line[] {
  const turn = running(state)
  const lines = fold(group(rows(state), turn), state.turns)
  return working(changed(lines, state), turn)
}

/** Whether `row` is work: a tool call or a thought. */
function isWork(line: Line): line is Extract<Row, { kind: "item" }> {
  return (
    line.kind === "item" &&
    (line.item.body.kind === "tool" || line.item.body.kind === "thought")
  )
}

/** The turn a line belongs to, if any. */
function turnOf(line: Line): string | undefined {
  switch (line.kind) {
    case "item":
      return line.item.turn
    case "work":
      return line.turn
    default:
      return line.turn.id
  }
}

function group(input: Row[], turn: TurnView | undefined): Line[] {
  const lines: Line[] = []
  let work: Item[] = []
  const flush = () => {
    if (work.length === 1) lines.push({ kind: "item", item: work[0] })
    else if (work.length > 1)
      lines.push({
        kind: "work",
        id: `work-${work[0].id}`,
        turn: work[0].turn,
        items: work,
        live: false,
      })
    work = []
  }
  for (const row of input) {
    if (isWork(row) && (work.length === 0 || work[0].turn === row.item.turn))
      work.push(row.item)
    else {
      flush()
      if (isWork(row)) work.push(row.item)
      else lines.push(row)
    }
  }
  flush()
  if (turn) {
    const last = lines.findLastIndex((line) => turnOf(line) === turn.id)
    const tail = lines[last]
    if (tail?.kind === "work") lines[last] = { ...tail, live: true }
  }
  return lines
}

/** A turn folds once it is done or a Person stopped it. One that failed
 * stays open, so its Person sees what went wrong. */
const FOLDS: ReadonlySet<TurnView["state"]> = new Set(["done", "stopped"])

function fold(lines: Line[], turns: TurnView[]): Line[] {
  const starts = new Map<number, Line>()
  const plans = new Map<number, Line>()
  const gone = new Set<number>()
  for (const turn of turns) {
    if (!FOLDS.has(turn.state)) continue
    const own = lines.flatMap((line, at) =>
      turnOf(line) === turn.id &&
      line.kind !== "ended" &&
      !(line.kind === "item" && line.item.id === turn.message)
        ? [at]
        : []
    )
    const reply = own.findLast((at) => {
      const line = lines[at]
      return line.kind === "item" && isReply(line.item)
    })
    // The turn's plan stays out of the fold; one in a reply is a card of
    // its own (ADR 0010, decision 6).
    const items = own.flatMap((at) => {
      const line = lines[at]
      return line.kind === "item" ? [line.item] : []
    })
    const plan = planOf(turn, items)
    const planned = own.find((at) => {
      const line = lines[at]
      return line.kind === "item" && line.item === plan
    })
    if (planned !== undefined && plan && isReply(plan))
      plans.set(planned, { kind: "plan", turn, item: plan })
    const folded = own.filter(
      (at) => (reply === undefined || at < reply) && at !== planned
    )
    if (!folded.some((at) => lines[at].kind === "work" || isWork(lines[at])))
      continue
    starts.set(folded[0], {
      kind: "fold",
      id: `fold-${turn.id}`,
      turn,
      lines: folded.map((at) => lines[at]),
    })
    for (const at of folded) gone.add(at)
  }
  return lines.flatMap((line, at) => {
    const start = starts.get(at)
    if (start) return [start]
    return gone.has(at) ? [] : [plans.get(at) ?? line]
  })
}

/** A turn that no longer runs or waits, and changed files, says which
 * after the last thing it wrote. */
function changed(lines: Line[], state: ThreadState): Line[] {
  const after = new Map<number, Line>()
  const byTurn = new Map<string | undefined, Item[]>()
  for (const item of state.items) {
    const own = byTurn.get(item.turn)
    if (own) own.push(item)
    else byTurn.set(item.turn, [item])
  }
  for (const turn of state.turns) {
    if (turn.state === "running" || turn.state === "queued") continue
    const files = changes(byTurn.get(turn.id) ?? [], turn.id)
    if (files.length === 0) continue
    const last = lines.findLastIndex(
      (line) => line.kind !== "ended" && turnOf(line) === turn.id
    )
    if (last >= 0) after.set(last, { kind: "changes", turn, files })
  }
  return lines.flatMap((line, at) => {
    const card = after.get(at)
    return card ? [line, card] : [line]
  })
}

function working(lines: Line[], turn: TurnView | undefined): Line[] {
  if (!turn) return lines
  const row: Line = { kind: "working", turn }
  const message = lines.findIndex(
    (line) => line.kind === "item" && line.item.id === turn.message
  )
  const first = lines.findIndex((line) => turnOf(line) === turn.id)
  const at = message >= 0 ? message + 1 : first >= 0 ? first : lines.length
  return [...lines.slice(0, at), row, ...lines.slice(at)]
}

/** What a line of work did, as a Person reads it: its two largest kinds,
 * "Ran 3 commands and edited 2 files". */
export function summary(items: Item[]): string {
  const counts = new Map<Kind, number>()
  for (const item of items) {
    const kind: Kind | undefined =
      item.body.kind === "thought"
        ? "think"
        : item.body.kind === "tool"
          ? item.body.tool
          : undefined
    if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  // The largest first; a tie keeps the order the Agent did them in.
  const kinds = [...counts].sort((a, b) => b[1] - a[1])
  const named = kinds.slice(0, 2).map(([kind, count]) => DID[kind](count))
  const rest = kinds.slice(2).reduce((sum, [, count]) => sum + count, 0)
  const words =
    named.length === 0
      ? "Worked"
      : rest > 0
        ? `${named.join(", ")} and ${rest} more`
        : named.join(" and ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

type Kind = ToolKind

const DID: Record<Kind, (count: number) => string> = {
  execute: (n) => (n === 1 ? "ran a command" : `ran ${n} commands`),
  read: (n) => (n === 1 ? "read a file" : `read ${n} files`),
  edit: (n) => (n === 1 ? "edited a file" : `edited ${n} files`),
  delete: (n) => (n === 1 ? "deleted a file" : `deleted ${n} files`),
  move: (n) => (n === 1 ? "moved a file" : `moved ${n} files`),
  search: (n) => (n === 1 ? "searched" : `searched ${n} times`),
  fetch: (n) => (n === 1 ? "fetched a page" : `fetched ${n} pages`),
  think: (n) => (n === 1 ? "thought" : `thought ${n} times`),
  other: (n) => (n === 1 ? "used a tool" : `used ${n} tools`),
}

/** How long `ms` took: "12s", "1m 05s", "2h 03m". */
export function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const pad = (n: number) => String(n).padStart(2, "0")
  if (minutes < 60) return `${minutes}m ${pad(seconds % 60)}s`
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`
}

/** What a folded turn says about itself. */
export function foldTitle(turn: TurnView): string {
  const took =
    turn.started !== undefined && turn.ended !== undefined
      ? duration(turn.ended - turn.started)
      : undefined
  if (turn.state === "stopped")
    return took ? `You stopped after ${took}` : "You stopped it"
  return took ? `Worked for ${took}` : "Worked"
}
