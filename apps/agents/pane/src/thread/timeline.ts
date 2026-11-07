/**
 * The Thread's lines as T3 Code shows them (ADR 0010, decision 1): the
 * Agent's tool calls and thoughts in a row are one line of work, a turn
 * that ended folds its work away behind how long it took and what it did,
 * and the turn that runs says, at its end, how long it has and what it
 * does now (ADR 0058, decisions 4 and 5). Pure, so plain tests cover it.
 */
import type {
  Item,
  ToolKind,
  TurnState,
  TurnView,
} from "@banda/contract/agents"
import { duration } from "@banda/ui/lib/words"
import { outcome, said, type Said as Words } from "../entries/parts/calls"
import { isWorkKind, staysKind } from "../entries/kinds"
import { changes, type FileChange, total } from "../entries/parts/changes"
import {
  isReply,
  planOf,
  type Row,
  rows,
  running,
  type Said,
  type ThreadState,
  type Tool,
} from "./state"

export type Line =
  | Row
  /** Two or more tool calls and thoughts in a row, from one turn. */
  | { kind: "work"; id: string; turn?: string; items: Item[] }
  /** What a turn that ended did before its last reply, its lines of work
   * opened into their calls: one list. */
  | { kind: "fold"; id: string; turn: TurnView; lines: Line[] }
  /** The turn that runs, after what it has done: what it does now. */
  | { kind: "working"; turn: TurnView; doing?: Doing }
  /** The reply a turn in plan mode ended with: the plan it proposed. */
  | { kind: "plan"; turn: TurnView; item: Said }
  /** The files a turn that ended changed, after what it wrote. */
  | { kind: "changes"; turn: TurnView; files: FileChange[] }

/** The Thread's lines, from the rows {@link rows} gives. */
export function timeline(state: ThreadState): Line[] {
  const turn = running(state)
  const lines = fold(group(rows(state)), state.turns)
  return working(changed(lines, state), turn, turn && doing(state, turn))
}

/** Whether `row` is work: a tool call or a thought. */
function isWork(line: Line): line is Extract<Row, { kind: "item" }> {
  return line.kind === "item" && isWorkKind(line.item.body.kind)
}

/** Whether `line` is an entry that stays out of its turn's fold. */
function staysOut(line: Line): boolean {
  return line.kind === "item" && staysKind(line.item.body.kind)
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

function group(input: Row[]): Line[] {
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
  return lines
}

/** A turn folds once it is done or a Person stopped it. One that failed
 * stays open, so its Person sees what went wrong. One stopped says so in
 * its fold, and only there. */
const FOLDS: ReadonlySet<TurnView["state"]> = new Set(["done", "stopped"])

function fold(lines: Line[], turns: TurnView[]): Line[] {
  const starts = new Map<number, Line>()
  const plans = new Map<number, Line>()
  const gone = new Set<number>()
  for (const turn of turns) {
    if (!FOLDS.has(turn.state)) continue
    // A Visual stays out, as the turn's message does: the Agent showed it
    // to be seen (ADR 0037), as T3 Code keeps its pages out of a fold.
    const own = lines.flatMap((line, at) =>
      turnOf(line) === turn.id &&
      line.kind !== "ended" &&
      !staysOut(line) &&
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
      lines: folded.flatMap((at) => opened(lines[at])),
    })
    for (const at of folded) gone.add(at)
    if (turn.state === "stopped") {
      const ended = lines.findIndex(
        (line) => line.kind === "ended" && line.turn.id === turn.id
      )
      if (ended >= 0) gone.add(ended)
    }
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

/** A line of work as a fold lists it: each of its calls and thoughts. */
function opened(line: Line): Line[] {
  return line.kind === "work"
    ? line.items.map((item) => ({ kind: "item", item }))
    : [line]
}

/** The turn that runs says so at its live edge: after the last thing it
 * did, or else the message that asked for it. */
function working(
  lines: Line[],
  turn: TurnView | undefined,
  now: Doing | undefined
): Line[] {
  if (!turn) return lines
  const row: Line = { kind: "working", turn, ...(now && { doing: now }) }
  const last = lines.findLastIndex((line) => turnOf(line) === turn.id)
  const message = lines.findIndex(
    (line) => line.kind === "item" && line.item.id === turn.message
  )
  const after = Math.max(last, message)
  const at = after >= 0 ? after + 1 : lines.length
  return [...lines.slice(0, at), row, ...lines.slice(at)]
}

/** What the turn that runs does now, as its live line says after how
 * long it has worked. */
export type Doing =
  /** A Question of it waits for the Person. */
  | { kind: "asking" }
  /** A call runs, since `since` (ms since the epoch). */
  | { kind: "calling"; said: Words; since: number }
  | { kind: "thinking" }

/** What `turn` does now: it waits on its Person while a Question of it is
 * open, or else what it did last, while that still goes. */
export function doing(state: ThreadState, turn: TurnView): Doing | undefined {
  const own = state.items.filter((item) => item.turn === turn.id)
  const open = (item: Item) =>
    item.body.kind === "question" && item.body.state === "open"
  if (own.some(open)) return { kind: "asking" }
  const last = own.at(-1)
  if (last?.body.kind === "thought") return { kind: "thinking" }
  if (last?.body.kind !== "tool") return undefined
  const now = outcome(last.body, turn.state)
  return now === "running"
    ? { kind: "calling", said: said(last.body, now), since: last.at }
    : undefined
}

/** The tool calls that wait for their Person: in each turn with a
 * Question open, its latest call that has not started. */
export function awaiting(state: ThreadState): Set<string> {
  const asking = new Set(
    state.items.flatMap((item) =>
      item.body.kind === "question" && item.body.state === "open"
        ? [item.turn]
        : []
    )
  )
  const calls = new Map<string | undefined, string>()
  for (const item of state.items)
    if (
      asking.has(item.turn) &&
      item.body.kind === "tool" &&
      item.body.status === "pending"
    )
      calls.set(item.turn, item.id)
  return new Set(calls.values())
}

/** How long each thought took, in ms, where that is known: until the next
 * thing its turn did, or until the turn ended. */
export function thoughtTimes(state: ThreadState): Map<string, number> {
  const ends = new Map(
    state.turns.flatMap((turn) =>
      turn.ended === undefined ? [] : [[turn.id, turn.ended] as const]
    )
  )
  const took = new Map<string, number>()
  // From the end, so each item knows when the next of its turn began.
  const next = new Map<string, number>()
  for (const item of state.items.toReversed()) {
    if (item.turn === undefined) continue
    if (item.body.kind === "thought") {
      const end = next.get(item.turn) ?? ends.get(item.turn)
      if (end !== undefined) took.set(item.id, Math.max(0, end - item.at))
    }
    next.set(item.turn, item.at)
  }
  return took
}

/** What a run of work did, as a Person reads it (ADR 0058, decision 4):
 * "ran 3 commands (1 failed), edited 2 files", and the lines it changed. */
export type Did = {
  /** Each kind of thing it did, in words, and how many of those failed. */
  kinds: { words: string; failed: number }[]
  added: number
  removed: number
}

/**
 * What `items` did in a turn that is `turn`: every kind of call that acts,
 * commands, edits, deletes and moves; or else the two it did most of those
 * that look; or else that it thought. In the turn that runs, a call counts
 * once it has ended: the live line says what goes on.
 */
export function did(items: Item[], turn?: TurnState): Did {
  const counts = new Map<Kind, { count: number; failed: number }>()
  const edited = new Set<string>()
  const add = (kind: Kind, failed: boolean, by = 1) => {
    const was = counts.get(kind) ?? { count: 0, failed: 0 }
    counts.set(kind, {
      count: was.count + by,
      failed: was.failed + (failed ? 1 : 0),
    })
  }
  const ended: Item[] = []
  for (const item of items) {
    if (item.body.kind === "thought") add("think", false)
    if (item.body.kind !== "tool") continue
    const now = outcome(item.body, turn)
    if (turn === "running" && (now === "running" || now === "waiting")) continue
    ended.push(item)
    const kind = item.body.tool
    add(kind, now === "failed", kind === "edit" ? fresh(item.body, edited) : 1)
  }
  const acts = ACTS.filter((kind) => counts.has(kind))
  // The most first; a tie keeps the order the Agent did them in.
  const looks = [...counts.keys()]
    .filter((kind) => LOOKS.includes(kind))
    .sort((a, b) => counts.get(b)!.count - counts.get(a)!.count)
    .slice(0, 2)
  const named: readonly Kind[] =
    acts.length > 0
      ? acts
      : looks.length > 0
        ? looks
        : counts.has("think")
          ? ["think"]
          : []
  // The lines changed, as the turn's changed files count them.
  const own = ended[0]?.turn
  return {
    kinds: named.map((kind) => {
      const { count, failed } = counts.get(kind)!
      return { words: DID[kind](count), failed }
    }),
    ...total(own === undefined ? [] : changes(ended, own)),
  }
}

/** How many files an edit changed that no edit before it did; one, when
 * it says none. */
function fresh(tool: Tool, edited: Set<string>): number {
  const paths = tool.content.flatMap((part) =>
    part.kind === "diff" ? [part.path] : []
  )
  if (paths.length === 0) return 1
  const added = paths.filter((path) => !edited.has(path))
  for (const path of added) edited.add(path)
  return added.length
}

/** "Ran 3 commands (1 failed), edited 2 files": a run of work's kinds as
 * one plain sentence, as a screen reader or a test reads it. */
export function didWords({ kinds }: Did): string {
  return kinds
    .map(({ words, failed }) =>
      failed ? `${words} (${failed} failed)` : words
    )
    .join(", ")
}

type Kind = ToolKind

/** Calls that change something, each named. */
const ACTS: readonly Kind[] = ["execute", "edit", "delete", "move"]
/** Calls that look, named when none acted. */
const LOOKS: readonly Kind[] = ["read", "search", "fetch", "other"]

const DID: Record<Kind, (count: number) => string> = {
  execute: (n) => (n === 1 ? "ran a command" : `ran ${n} commands`),
  read: (n) => (n === 1 ? "read a file" : `read ${n} files`),
  edit: (n) => (n === 1 ? "edited a file" : `edited ${n} files`),
  delete: (n) => (n === 1 ? "deleted a file" : `deleted ${n} files`),
  move: (n) => (n === 1 ? "moved a file" : `moved ${n} files`),
  search: (n) => (n === 1 ? "searched once" : `searched ${n} times`),
  fetch: (n) => (n === 1 ? "fetched a page" : `fetched ${n} pages`),
  think: (n) => (n === 1 ? "thought" : `thought ${n} times`),
  other: (n) => (n === 1 ? "used a tool" : `used ${n} tools`),
}

/** The items a fold or a line of work holds, its calls and thoughts. */
export function workOf(lines: Line[]): Item[] {
  return lines.flatMap((line) =>
    line.kind === "work" ? line.items : isWork(line) ? [line.item] : []
  )
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
