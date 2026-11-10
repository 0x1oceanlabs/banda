/**
 * A Thread's sub-agents as its Pane places and words them (ADR 0103,
 * decisions 15–17): a row where each started, a group of the ones one
 * message started, what each does now or how it ended. The same for every
 * client (ADR 0089, decision 1); the views draw what this says. Pure, so
 * plain tests cover it.
 */
import type {
  Item,
  Subagent,
  SubagentId,
  SubagentState,
} from "@banda/contract/agents"
import { SATELLITE_WORDS, type SatelliteState } from "@banda/ui/lib/satellite"
import { ago, duration } from "@banda/ui/lib/words"
import { plain } from "../asking/asking"
import { outcome, said } from "../entries/parts/calls"
import { firstLine } from "../entries/parts/messageText"
import { ends } from "./facts"

/** How a sub-agent looks: its satellite's state (ADR 0103, decision 12). */
export function lookOf(lane: Subagent): SatelliteState {
  return lane.state === "running" ? "working" : lane.state
}

/** Its state in Banda's words (ADR 0103, decision 3): "Working", "Asks",
 * "Done"… */
export function stateWord(lane: Subagent): string {
  return SATELLITE_WORDS[lookOf(lane)]
}

/** Whether it has ended, as it can end: done, failed, stopped or lost. */
export function ended(lane: Subagent): boolean {
  return ends(lane.state)
}

/** The sub-agents no sub-agent started: the ones its Thread shows. */
export function direct(lanes: readonly Subagent[]): Subagent[] {
  return lanes.filter((lane) => lane.parent === undefined)
}

/** The sub-agents `lane` started, in the order they started. */
export function childrenOf(
  lane: Subagent,
  lanes: readonly Subagent[]
): Subagent[] {
  return lanes.filter((one) => one.parent === lane.id)
}

/** The sub-agents started beside `lane`, itself among them, in the order
 * they started: by the same parent, in the same turn. */
export function siblingsOf(
  lane: Subagent,
  lanes: readonly Subagent[]
): Subagent[] {
  return lanes.filter(
    (one) => one.parent === lane.parent && one.turn === lane.turn
  )
}

/** The Thread's sub-agents by their ID, for the rows that name them. */
export function byId(
  lanes: readonly Subagent[]
): ReadonlyMap<SubagentId, Subagent> {
  return new Map(lanes.map((lane) => [lane.id, lane]))
}

/** The sub-agents a line's anchors name, in its order; one the Thread
 * no longer has is left out. */
export function lanesOf(
  anchors: readonly Item[],
  lanes: ReadonlyMap<SubagentId, Subagent>
): Subagent[] {
  return anchors.flatMap((item) => {
    const lane =
      item.body.kind === "subagent" ? lanes.get(item.body.subagent) : undefined
    return lane ? [lane] : []
  })
}

/** Claude Code's default role, which names no kind of helper. */
const GENERAL = "general-purpose"

/** Codex's own title for a sub-agent its parent gave no name: "Agent",
 * or "Agent" and the last 8 characters of its thread's ID, a UUID's lower
 * hex, which never shows (ADR 0103, decision 17). A name its parent gave,
 * "Agent research" from `agent_research`, is a title. */
const FALLBACK = /^Agent(?: [0-9a-f]{8})?$/

/** "Agent 2": a sub-agent named by its number among `siblings`, in the
 * order they started. */
function numbered(lane: Subagent, siblings: readonly Subagent[]): string {
  const at = siblings.findIndex((one) => one.id === lane.id)
  return `Agent ${at < 0 ? 1 : at + 1}`
}

/** Its title as a row says it: the Harness's, or else "Agent 2" by its
 * number among `siblings`, for Codex's fallback and a title cleared. */
function titled(lane: Subagent, siblings: readonly Subagent[]): string {
  const title = lane.title.trim()
  return title && !FALLBACK.test(title) ? title : numbered(lane, siblings)
}

/**
 * What names a sub-agent (ADR 0103, decision 17): its role, unless that
 * is Claude's default `general-purpose`, then its title; a Codex one, with
 * no role, by its title. Codex's own fallback title, "Agent" or "Agent
 * ‹8 characters of its id›", gives way to its number among `siblings`, in
 * the order they started: "Agent 2".
 */
export function labelOf(lane: Subagent, siblings: readonly Subagent[]): string {
  const role = lane.role?.trim()
  return role && role !== GENERAL ? role : titled(lane, siblings)
}

/** Its role, short: `general-purpose` reads "general". */
function roleWord(lane: Subagent): string | undefined {
  const role = lane.role?.trim()
  return role === GENERAL ? "general" : role || undefined
}

/**
 * Its role and model, muted after its title: "Explore · Haiku 5.5",
 * "general". The model shows only when it is not its parent's,
 * `parentModel`, by its name.
 */
export function roleOf(
  lane: Subagent,
  parentModel?: string
): string | undefined {
  const model = lane.model?.trim()
  const parts = [roleWord(lane), model !== parentModel ? model : undefined]
  return parts.filter(Boolean).join(" · ") || undefined
}

/** What a row says it does now, or how it ended: `lead` in bold before
 * it, `mono` a command, drawn as code. */
export type Now = { text: string; lead?: string; mono?: true }

/** `now` as one line of words, as a screen reader or a test reads it. */
export function nowWords({ lead, text }: Now): string {
  return lead ? `${lead} ${text}` : text
}

/** The Question `lane` asks that is still open: its Thread's, whose body
 * names it (ADR 0103, decision 8). */
function askedBy(lane: Subagent, items: readonly Item[]): string | undefined {
  for (const { body } of items)
    if (
      body.kind === "question" &&
      body.state === "open" &&
      body.sub === lane.id
    )
      return body.title
  return undefined
}

/** What the last thing heard of a sub-agent at work says it does: its call
 * as the work line says it ("Reading settings.ts", or the command, ">_
 * pnpm vitest"), or "Thinking". */
function doingOf(heard: Item | undefined): Now | undefined {
  if (heard?.body.kind === "thought") return { text: "Thinking" }
  if (heard?.body.kind !== "tool") return undefined
  const tool = heard.body
  const { verb, subject } = said(tool, outcome(tool))
  if (tool.tool === "execute") return { text: `>_ ${subject}`, mono: true }
  return { text: [verb, subject].filter(Boolean).join(" ") }
}

/**
 * What a sub-agent's row says it does now, or how it ended (ADR 0103,
 * decision 15). While it asks: its open Question's title, after "Asks:",
 * without a Harness's code marks, as the Thread says a Question.
 * While it works: what was last heard of it (`heard`, the window's memory,
 * which a read forgets), its call or "Thinking", or else its state's word.
 * Done: its report's first line. Failed, stopped or lost: why, or the
 * state's word. `items` are its Thread's, which hold its Questions.
 */
export function nowOf(
  lane: Subagent,
  heard: ReadonlyMap<SubagentId, Item> | undefined,
  items: readonly Item[]
): Now {
  const word = { text: stateWord(lane) }
  switch (lane.state) {
    case "done":
      return { text: firstLine(lane.report) ?? word.text }
    case "failed":
    case "stopped":
    case "lost":
      return { text: lane.why?.trim() || word.text }
    case "asks": {
      const title = askedBy(lane, items)
      if (title !== undefined) return { lead: "Asks:", text: plain(title) }
      return doingOf(heard?.get(lane.id)) ?? word
    }
    case "running":
    case "queued":
      return doingOf(heard?.get(lane.id)) ?? word
  }
}

/** "(+2)": how many sub-agents `lane` started itself, whatever their
 * state; none when it started none. The Thread shows one level (ADR 0103,
 * decision 16). */
export function plus(
  lane: Subagent,
  lanes: readonly Subagent[]
): string | undefined {
  const own = childrenOf(lane, lanes).length
  return own > 0 ? `(+${own})` : undefined
}

/** How long it has been at work, or how long it took: "now" in its first
 * minute and "3m" after while it works, its duration once it ended.
 * Neither ticks: a working row's time moves by the minute, and only the
 * live line counts the seconds (ADR 0103, decision 20). */
export function timeOf(lane: Subagent, now = Date.now()): string {
  return lane.ended !== undefined && ended(lane)
    ? duration(lane.ended - lane.started)
    : ago(lane.started, now)
}

/** What the window knows that a sub-agent's row says. */
export type RowFacts = {
  /** Its Thread's sub-agents, nested ones too, in the order they
   * started. */
  lanes: readonly Subagent[]
  /** What was last heard of each, as the Pane followed its Thread. */
  heard?: ReadonlyMap<SubagentId, Item>
  /** Its Thread's entries, which hold its Questions. */
  items: readonly Item[]
  /** The model its parent runs on, by its name. */
  parentModel?: string
  /** Now, in ms since the epoch. */
  now?: number
}

/** What a sub-agent's row says, as data (ADR 0103, decision 15). */
export type RowSaid = {
  look: SatelliteState
  /** What the row says first: the Harness's title, or "Agent 2". */
  title: string
  /** What names it (decision 17), as its trigger's name says. */
  label: string
  /** Its role and model, muted: "Explore · Haiku 5.5". */
  role?: string
  /** What it does now, or how it ended. */
  now: Now
  /** "(+2)": its own sub-agents. */
  plus?: string
  /** Its still time: "3m", or "1m 12s" once it ended. */
  time: string
  /** It asks: its time takes the attention's colour. */
  asks: boolean
  /** It failed: it wears a "Failed" tag. */
  failed: boolean
}

/** What sub-agent `lane`'s row says. */
export function rowOf(lane: Subagent, facts: RowFacts): RowSaid {
  const siblings = siblingsOf(lane, facts.lanes)
  return {
    look: lookOf(lane),
    title: titled(lane, siblings),
    label: labelOf(lane, siblings),
    role: roleOf(lane, facts.parentModel),
    now: nowOf(lane, facts.heard, facts.items),
    plus: plus(lane, facts.lanes),
    time: timeOf(lane, facts.now),
    asks: lane.state === "asks",
    failed: lane.state === "failed",
  }
}

/** One count of a group's line: "2 working", "1 asks" in the attention's
 * colour, "1 failed" in the destructive's. */
export type Count = { words: string; tone?: "asks" | "failed" }

/** The line of a group of sub-agents one message started (ADR 0103,
 * decisions 14 and 15). */
export type Group = {
  /** Every one has ended: the line folds, dimmed, until it is opened. */
  settled: boolean
  /** "3 sub-agents", bold; "Ran 3 sub-agents" once settled. */
  head: string
  /** While they work, how many are in each state; settled, how long they
   * took, from the first start to the last end. */
  counts: Count[]
  /** The first three's looks, its satellites. */
  looks: SatelliteState[]
}

/** The order a group counts its states in, as the kit does. */
const COUNTED: { state: SubagentState; words: string; tone?: Count["tone"] }[] =
  [
    { state: "running", words: "working" },
    { state: "asks", words: "asks", tone: "asks" },
    { state: "done", words: "done" },
    { state: "failed", words: "failed", tone: "failed" },
    { state: "stopped", words: "stopped" },
    { state: "queued", words: "waiting" },
    { state: "lost", words: "lost" },
  ]

/** The group of `lanes`: "3 sub-agents · 2 working · 1 asks", or once all
 * have ended, "Ran 3 sub-agents · 2m 40s". */
export function groupOf(lanes: readonly Subagent[]): Group {
  const settled = lanes.length > 0 && lanes.every(ended)
  const noun = lanes.length === 1 ? "sub-agent" : "sub-agents"
  const looks = lanes.slice(0, 3).map(lookOf)
  if (settled) {
    const first = Math.min(...lanes.map((lane) => lane.started))
    const last = Math.max(...lanes.map((lane) => lane.ended ?? lane.started))
    return {
      settled,
      head: `Ran ${lanes.length} ${noun}`,
      counts: [{ words: duration(last - first) }],
      looks,
    }
  }
  const counts = COUNTED.flatMap(({ state, words, tone }): Count[] => {
    const n = lanes.filter((lane) => lane.state === state).length
    return n > 0 ? [{ words: `${n} ${words}`, ...(tone && { tone }) }] : []
  })
  return { settled, head: `${lanes.length} ${noun}`, counts, looks }
}

/** A group's line as one line of words, as a screen reader or a test
 * reads it. */
export function groupWords({ head, counts }: Group): string {
  return [head, ...counts.map((count) => count.words)].join(" · ")
}

/**
 * The words Find matches in a sub-agent's row (ADR 0103, Open questions):
 * its title and label, its role, its model where the row shows it, not its
 * parent's `parentModel`, and how it ended, its report's first line or
 * why. Never what it does now, which changes as it works; read from its
 * record, never its entries. `lanes` are its Thread's.
 */
export function wordsOf(
  lane: Subagent,
  lanes: readonly Subagent[],
  parentModel?: string
): string {
  const siblings = siblingsOf(lane, lanes)
  const end =
    lane.state === "done"
      ? firstLine(lane.report)
      : ended(lane)
        ? lane.why?.trim()
        : undefined
  const words = [
    titled(lane, siblings),
    labelOf(lane, siblings),
    roleOf(lane, parentModel),
  ]
  return [...new Set([...words, end].filter(Boolean))].join("\n")
}
