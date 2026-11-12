/**
 * A sub-agent opened beside its Thread, as a Pane in its Group (ADR 0103,
 * decision 21): what the Pane's args name, how it goes a level deeper and
 * back up, and what its header, its brief and its status bar say. The
 * same for every client (ADR 0089, decision 1); the views draw what this
 * says. Pure, so plain tests cover it.
 */
import type {
  Crew,
  Item,
  Subagent,
  SubagentId,
  ThreadId,
  TurnView,
} from "@banda/contract/agents"
import type { SatelliteState } from "@banda/ui/lib/satellite"
import { duration } from "@banda/ui/lib/words"
import { type LaneState, turnStateOf } from "./live-lane"
import type { Followed } from "./live-thread"
import { NOTHING } from "./state"
import { askerOf, labelOf, lookOf, siblingsOf, stateWord } from "./subagents"

/** The window's action that opens a sub-agent beside its Thread. Its
 * args: `project`, the {@link SubagentArgs}' `thread` and `sub`, and
 * `agent`, the Thread's Agent, whose Group the Pane joins. A Thread has
 * one such Pane: asked for another sub-agent, it shows that one. */
export const OPEN_BESIDE = "agents.subagent.open"

/** What a sub-agent's Pane shows, kept with it across a restart. Where it
 * sits among its Thread's sub-agents comes from their parents, so args
 * saved with more, as a `path` from before, show the same. */
export type SubagentArgs = {
  /** The Thread it works in. */
  thread: ThreadId
  /** The sub-agent it shows. */
  sub: SubagentId
}

/** The sub-agents above `lane`, from the one its Thread started down to
 * its parent, as `lanes` name them; a parent `lanes` do not have is the
 * last one named. */
export function pathOf(
  lane: Subagent,
  lanes: readonly Subagent[]
): SubagentId[] {
  const parents = new Map(lanes.map((one) => [one.id, one.parent]))
  const path: SubagentId[] = []
  const seen = new Set([lane.id])
  for (let up = lane.parent; up !== undefined && !seen.has(up);) {
    path.unshift(up)
    seen.add(up)
    up = parents.get(up)
  }
  return path
}

/** The Pane on `lane` of Thread `thread`, one level up, on its parent, as
 * `Esc` takes it; none at the top, where `Esc` does nothing new. */
export function upOf(
  thread: ThreadId,
  lane: Subagent
): SubagentArgs | undefined {
  return lane.parent === undefined ? undefined : { thread, sub: lane.parent }
}

/** The row its Thread lights while its Pane shows `lane`, among `lanes`:
 * the sub-agent its Thread started that it is, or is under. */
export function litOf(lane: Subagent, lanes: readonly Subagent[]): SubagentId {
  return pathOf(lane, lanes)[0] ?? lane.id
}

/** How many words of its Thread's title a breadcrumb keeps. */
const SHORT = 3

/** A Thread's title as a breadcrumb names it: its first words. */
export function shortTitle(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean)
  return words.length > 0 ? words.slice(0, SHORT).join(" ") : THREAD
}

/** What names a Thread with no title yet. */
const THREAD = "Thread"

/** One step of a nested sub-agent's breadcrumb: its words, and where a
 * click takes the Pane: to its Thread's own Pane, or to that level. */
export type Crumb = { words: string; to: "thread" | SubagentArgs }

/** What a sub-agent's Pane says in its header (ADR 0103, decision 21). */
export type Head = {
  look: SatelliteState
  /** What names it (decision 17). */
  label: string
  /** At the top level, muted after its label: "sub-agent of ‹Thread›". */
  of?: string
  /** Nested, before its label: its Thread's title, short, then the
   * sub-agents above it. */
  crumbs?: Crumb[]
  /** Nested, muted after its label: its title, where its role names it. */
  title?: string
}

/**
 * The header of the Pane showing `lane` of Thread `thread`, titled
 * `title`, whose sub-agents are `lanes`. At the top level: its satellite,
 * its label and "sub-agent of ‹Thread›". Nested: the breadcrumb, "‹Thread,
 * short› › Reviewer", before its label, then its title muted; one above
 * it that `lanes` do not have is a "Sub-agent".
 */
export function headOf(
  thread: ThreadId,
  lane: Subagent,
  lanes: readonly Subagent[],
  title: string
): Head {
  const look = lookOf(lane)
  const label = labelOf(lane, siblingsOf(lane, lanes))
  const path = pathOf(lane, lanes)
  if (path.length === 0)
    return { look, label, of: `sub-agent of ${title.trim() || THREAD}` }
  const crumbs: Crumb[] = [
    { words: shortTitle(title), to: "thread" },
    ...path.map((sub) => ({
      words: askerOf(sub, lanes) ?? "Sub-agent",
      to: { thread, sub },
    })),
  ]
  // Its title says more only where its role names it: "Explore", then
  // "Find b.txt".
  const own = lane.title.trim()
  const more = own && lane.role?.trim() === label && own !== label
  return { look, label, crumbs, ...(more && { title: own }) }
}

/** Who set a sub-agent to work, over its brief: its Harness, "Claude
 * asked" by its logo; or, nested, the sub-agent that started it,
 * "Reviewer asked" by that one's satellite (`look`). Over what it wrote
 * to it later, "Claude wrote" (ADR 0103, decision 25). */
export type Asked = { words: string; look?: SatelliteState }

/** Who set `lane` to work, among `lanes`, as its brief says it, or, as
 * `verb` says, wrote to it after: its parent, by its label and its look,
 * or else its Thread's Harness, `short`. */
export function askedOf(
  lane: Subagent,
  lanes: readonly Subagent[],
  short: string,
  verb: "asked" | "wrote" = "asked"
): Asked {
  const parent = lanes.find((one) => one.id === lane.parent)
  const words = `${askerOf(lane.parent, lanes) ?? short} ${verb}`
  return parent ? { words, look: lookOf(parent) } : { words }
}

/** The words of the status bar's button, which asks the Thread's own
 * Agent, by its Harness's short name, about the sub-agent (ADR 0103,
 * decision 25): "Ask Claude about it". */
export function askWords(short: string): string {
  return `Ask ${short} about it`
}

/** What a sub-agent's status bar says, in the composer's place (ADR 0103,
 * decision 21): its satellite, its state's word, then the rest, each after
 * a "·". */
export type Status = {
  look: SatelliteState
  /** "Working", "Asks", "Done"… */
  word: string
  rest: string[]
}

/**
 * The status bar of `lane`, among its Thread's `lanes`: its state's word;
 * its model where its Thread's, `model`, is another; then, while it works,
 * "Runs on its own"; done, how long it took, a still duration (decision
 * 20), and that it returned its answer to its parent, or its Harness,
 * `short`; failed, stopped or lost, why, where the Harness or Banda said.
 * No role: a role names it in its label already, and Claude's default,
 * `general-purpose`, is no role (decision 17).
 */
export function statusOf(
  lane: Subagent,
  lanes: readonly Subagent[],
  { model, short }: { model?: string; short: string }
): Status {
  const own = lane.model?.trim()
  const rest = [own !== model ? own : undefined, ...stands(lane, lanes, short)]
  return {
    look: lookOf(lane),
    word: stateWord(lane),
    rest: rest.filter((part): part is string => Boolean(part)),
  }
}

/** How `lane` stands, after who it is: done, it returned its answer to
 * whoever set it to work, its parent or its Harness, `short`. */
function stands(
  lane: Subagent,
  lanes: readonly Subagent[],
  short: string
): (string | undefined)[] {
  switch (lane.state) {
    case "running":
      return ["Runs on its own"]
    case "done":
      return [
        lane.ended === undefined
          ? undefined
          : duration(lane.ended - lane.started),
        lane.report?.trim()
          ? `Returned its answer to ${askerOf(lane.parent, lanes) ?? short}`
          : undefined,
      ]
    case "failed":
    case "stopped":
    case "lost":
      return [lane.why?.trim()]
    case "asks":
    case "queued":
      return []
  }
}

/** A status bar as one line of words, as a screen reader or a test reads
 * it. */
export function statusWords({ word, rest }: Status): string {
  return [word, ...rest].join(" · ")
}

/** A sub-agent's work as its Pane draws it, while its parent has set it
 * to work once: one turn as long as it worked, which runs while it works
 * or asks; one for each record of it, so a fact that does not change it
 * draws nothing new. Nobody may stop, edit or fork it: Banda shows a
 * Harness's sub-agents and manages none (ADR 0103, call 11). */
const TURNS = new WeakMap<Subagent, TurnView[]>()

function turnsOf(subagent: Subagent): TurnView[] {
  const was = TURNS.get(subagent)
  if (was) return was
  const turns = [delegation(subagent, subagent.turn, "", subagent.started)]
  TURNS.set(subagent, turns)
  return turns
}

/** A turn of `subagent`'s Pane from `started`, as it stands now. */
function delegation(
  subagent: Subagent,
  id: string,
  message: string,
  started: number
): TurnView {
  return {
    id,
    message,
    state: turnStateOf(subagent),
    started,
    ...(subagent.ended !== undefined && { ended: subagent.ended }),
    can: NOTHING,
  }
}

/** A sub-agent's entries as the turns of its Pane, one a delegation. */
type Delegations = { turns: TurnView[]; items: Item[] }

/** The delegations last worked out, for the entries they were of. */
const DELEGATED = new WeakMap<
  Item[],
  { subagent: Subagent; delegations: Delegations }
>()

/** Each entry moved to a later delegation, by the entry it was. */
const MOVED = new WeakMap<Item, Item>()

/**
 * `subagent`'s entries, `items`, as its Pane's turns (ADR 0103, decisions
 * 21 and 25): one for each time its parent set it to work, its brief's,
 * then one from each message with words its parent wrote it after, which
 * shows over that turn as "Claude wrote". Each folds its own work and
 * keeps its own reply, as a Thread's turns do. Each but the last is done,
 * ended at its last entry; the last stands as the sub-agent does. A
 * message with no words, queued for it at work, starts none. Entries of a
 * later turn carry its ID; the rest stay the objects they were.
 */
export function delegations(subagent: Subagent, items: Item[]): Delegations {
  const was = DELEGATED.get(items)
  if (was?.subagent === subagent) return was.delegations
  const turns: TurnView[] = []
  const moved: Item[] = []
  let [id, message, started, last] = [subagent.turn, "", subagent.started, 0]
  for (const item of items) {
    const { body } = item
    if (
      body.kind === "messaged" &&
      body.subagent === subagent.id &&
      body.text
    ) {
      const before = delegation(subagent, id, message, started)
      turns.push({ ...before, state: "done", ended: Math.max(started, last) })
      id = `${subagent.turn}:${item.id}`
      message = item.id
      started = item.at
    }
    last = item.at
    moved.push(item.turn === id ? item : movedTo(item, id))
  }
  const delegated: Delegations =
    turns.length === 0
      ? { turns: turnsOf(subagent), items }
      : {
          turns: [...turns, delegation(subagent, id, message, started)],
          items: moved,
        }
  DELEGATED.set(items, { subagent, delegations: delegated })
  return delegated
}

/** `item` in turn `turn`, the same object for as long as it is. */
function movedTo(item: Item, turn: string): Item {
  const was = MOVED.get(item)
  if (was?.turn === turn) return was
  const now = { ...item, turn }
  MOVED.set(item, now)
  return now
}

/** No calls of its sub-agents that change files: its Pane counts no
 * changes. */
const NO_EDITS: Item[] = []
const NO_CREWS: Crew[] = []

/**
 * Sub-agent `lane` as its Pane draws it, as a Thread's state with a turn
 * for each time it was set to work (ADR 0103, decisions 21 and 25,
 * {@link delegations}): its own entries; and from `thread`, its Thread,
 * the rest: its title, its Harness and model, its sub-agents, whose rows
 * the Pane shows one level down, and what each last did. What did not
 * change keeps its object.
 */
export function laneThread(thread: Followed, lane: LaneState): Followed {
  const { subagent } = lane
  // What the lane's own read knows before its Thread's facts say it.
  const known = new Set(thread.subagents.map((one) => one.id))
  const fresh = [subagent, ...lane.subagents].filter(
    (one) => !known.has(one.id)
  )
  const { turns, items } = delegations(subagent, lane.items)
  return {
    at: lane.at,
    title: thread.title,
    harness: thread.harness,
    items,
    turns,
    settings: thread.settings,
    offer: thread.offer,
    held: false,
    subagents:
      fresh.length > 0 ? [...thread.subagents, ...fresh] : thread.subagents,
    // A lane holds no Crews of its own.
    crews: NO_CREWS,
    edits: NO_EDITS,
    ...(thread.heard && { heard: thread.heard }),
  }
}
