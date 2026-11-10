/**
 * The list holds still (ADR 0098, decision 6): a card never moves from
 * under a click, and what is new takes its place when the hold lets go,
 * silently, with no pill to count it. While it holds, what is drawn is
 * frozen: the parts and the groups, which cards are in each and in which
 * order, so no card's place changes; what each card says stays live, and
 * so do the counts. A card that left the tab stays in its slot, dimmed,
 * saying where it went; one new to the tab waits. The Person's own acts in
 * this window that take a card elsewhere apply at once: one by key closes
 * its slot, one by the pointer leaves a ghost line there until the hold
 * lets go.
 *
 * It holds while the pointer is over the list, while a popup anchored in
 * it is open, for 2 s after a list key and in check mode, and lets go
 * 150 ms after the last of those ends, or at once when the window goes
 * away. Pure, so plain tests cover it.
 */
import type { Stand } from "@banda/ui/status"
import { clock } from "@banda/core"
import type { Row } from "./arrange"
import type { Block, Entry } from "./inbox"

/** A row's key: its Project's and its own, as Alt+U and the counts walk
 * them. */
export function rowKey(row: Row): string {
  return `${row.project.id}:${row.listed.id}`
}

/** A card's key in the list: its machine's and its Thread's, so it stays
 * the same node, with its Mark, from one part to another, and to another
 * Project. */
export function itemKey(row: Row): string {
  return keyOf(row.host, row.listed.id)
}

/** The key of `thread` on `host`; none for this machine. */
export function keyOf(host: string | undefined, thread: string): string {
  return `${host ?? ""}:${thread}`
}

/** How the Person acted on a card in this window: by a key, or by the
 * pointer. */
export type By = "key" | "pointer"

/** An act of the Person's on a card in this window: how, and where the
 * card stood as they took it. */
export type Own = { by: By; was: Stand }

/** The cards the Person acted on in this window while the list held, by
 * their keys. */
export type Mine = ReadonlyMap<string, Own>

/** Where a card is put away: Later and the Archive. */
const AWAY: ReadonlySet<Stand> = new Set(["later", "archived"])

/** Whether an act on a card takes it from `from` to `to`: to or from Later
 * or the Archive, or between Your turn and Open, as marked unread or read.
 * Its Agent's work, as a turn that ends or begins, is never the Person's
 * act, even on a card they just renamed, and holds as any change from
 * outside does. */
function byAct(from: Stand, to: Stand): boolean {
  if (from === to) return false
  if (AWAY.has(from) || AWAY.has(to)) return true
  return from !== "working" && to !== "working"
}

/** Where a card that left the tab went: its place now, or deleted, from
 * the place it is drawn in; when it wakes, if it sleeps. */
export type Went = {
  to: Stand | "deleted"
  from: Stand
  until?: number
  someday?: boolean
}

/** What the list now has that the hold keeps from it. */
export type Next = {
  blocks: readonly Block[]
  /** Every row, of every tab, to say where a card that left went. */
  rows: readonly Row[]
}

export type Held = {
  /** What is drawn: the blocks as they were drawn, each card saying what
   * it says now. */
  blocks: Block[]
  /** The cards the Person's pointer took out of the tab, drawn as one
   * line in their slots: where each went. */
  ghosts: ReadonlyMap<string, Went>
  /** The cards that left the tab otherwise, dimmed in their slots: where
   * each went. */
  leaving: ReadonlyMap<string, Went>
  /** The cards new to the tab, not drawn until the hold lets go. */
  coming: string[]
  /** The cards whose slots the Person's acts by key closed. */
  closed: string[]
}

const NONE: ReadonlyMap<string, Went> = new Map()

/**
 * `next` as `drawn` drew it, with the Person's own acts, `mine`, applied
 * at once where they took a card elsewhere; with nothing drawn to hold,
 * `next` as it is.
 */
export function hold(
  next: Next,
  drawn: readonly Block[] | undefined,
  mine: Mine
): Held {
  if (!drawn)
    return {
      blocks: [...next.blocks],
      ghosts: NONE,
      leaving: NONE,
      coming: [],
      closed: [],
    }
  // Where each card is now, and the blocks that are not cards, by key;
  // where the tab lists cards, its parts and the cut lists' ends.
  const placed = new Map<string, { entry: Entry; block: string }>()
  const blocks = new Map<string, Block>()
  const listing = new Set<Stand>()
  for (const block of next.blocks) {
    blocks.set(block.key, block)
    if (block.kind === "more") listing.add(block.of)
    if (block.kind === "rows") {
      listing.add(block.stand)
      for (const entry of block.rows)
        placed.set(itemKey(entry.row), { entry, block: block.key })
    }
  }
  const rows = new Map(next.rows.map((row) => [itemKey(row), row]))
  // The Person's acts that took their cards elsewhere since: those apply
  // at once.
  const ours = new Map(
    [...mine].filter(([key, { was }]) => {
      const to = rows.get(key)?.stand
      return to !== undefined && byAct(was, to)
    })
  )
  // The part each card is drawn in, and the parts drawn.
  const shownIn = new Map<string, string>()
  const parts = new Set<string>()
  for (const block of drawn)
    if (block.kind === "rows") {
      parts.add(block.key)
      for (const { row } of block.rows) shownIn.set(itemKey(row), block.key)
    }
  // The Person moved it to another part that is drawn: it goes there now.
  const moved = (key: string) => {
    const now = placed.get(key)
    return (
      ours.has(key) &&
      !!now &&
      now.block !== shownIn.get(key) &&
      parts.has(now.block)
    )
  }
  const ghosts = new Map<string, Went>()
  const leaving = new Map<string, Went>()
  const closed: string[] = []
  const held = drawn.map((block): Block => {
    if (block.kind !== "rows") return blocks.get(block.key) ?? block
    const kept = block.rows.flatMap((entry): Entry[] => {
      const key = itemKey(entry.row)
      const now = placed.get(key)
      if (moved(key)) return []
      if (now) return [now.entry]
      const by = ours.get(key)?.by
      const row = rows.get(key)
      // Still in the tab, past the end of a cut list as the Working
      // shelf's: it changed part, and says so in its slot.
      if (row && !by && listing.has(row.stand)) return [{ row, at: entry.at }]
      if (by === "key") {
        closed.push(key)
        return []
      }
      const went: Went = {
        to: row?.stand ?? "deleted",
        from: block.stand,
        ...(row?.listed.later?.until === undefined
          ? {}
          : { until: row.listed.later.until }),
        ...(row?.listed.later?.someday ? { someday: true } : {}),
      }
      ;(by === "pointer" ? ghosts : leaving).set(key, went)
      return [{ row: row ?? entry.row, at: entry.at }]
    })
    // What the Person's own acts bring into this part, where it is now.
    const now = blocks.get(block.key)
    if (now?.kind !== "rows") return { ...block, rows: kept }
    const brought = now.rows.filter((entry) => {
      const key = itemKey(entry.row)
      return ours.has(key) && shownIn.get(key) !== block.key
    })
    return { ...block, rows: among(kept, brought, now) }
  })
  const coming = [...placed]
    .filter(
      ([key, { block }]) =>
        !shownIn.has(key) && !(ours.has(key) && parts.has(block))
    )
    .map(([key]) => key)
  return {
    blocks: emptied(held, blocks, ours.size > 0),
    ghosts,
    leaving,
    coming,
    closed,
  }
}

/** What stands for what is gone: a head, a hairline or a "+ N more". */
const STANDING: ReadonlySet<Block["kind"]> = new Set([
  "head",
  "divider",
  "more",
])

/**
 * `held` with what the Person's own acts emptied gone too: a part with no
 * card left, and a head, a hairline or a "+ N more" the list no longer
 * has, beside no card. Inbox zero, or a tab's empty words, that `mine`
 * brought, come at once, in the same commit.
 */
function emptied(
  held: readonly Block[],
  now: ReadonlyMap<string, Block>,
  mine: boolean
): Block[] {
  const kept = held.filter(
    (block) => block.kind !== "rows" || block.rows.length > 0
  )
  const cards = (block: Block | undefined) => block?.kind === "rows"
  // A head stands over its cards, "+ N more" under them, and the hairline
  // between two parts.
  const blocks = kept.filter((block, i) => {
    if (!STANDING.has(block.kind) || now.has(block.key)) return true
    if (block.kind === "head") return cards(kept[i + 1])
    if (block.kind === "more") return cards(kept[i - 1])
    return cards(kept[i - 1]) && cards(kept[i + 1])
  })
  if (!mine) return blocks
  const drawn = new Set(blocks.map((block) => block.key))
  const brought = [...now.values()].filter(
    (block) =>
      (block.kind === "zero" || block.kind === "empty") && !drawn.has(block.key)
  )
  const zero = brought.filter((block) => block.kind === "zero")
  const empty = brought.filter((block) => block.kind === "empty")
  return [...zero, ...blocks, ...empty]
}

/** `kept` with each of `brought` after the card that comes before it in
 * `block` as it is now, or first where none of those is kept. */
function among(
  kept: readonly Entry[],
  brought: readonly Entry[],
  block: Extract<Block, { kind: "rows" }>
): Entry[] {
  const order = block.rows.map(({ row }) => itemKey(row))
  const into = [...kept]
  for (const entry of brought) {
    const at = order.indexOf(itemKey(entry.row))
    const before = new Set(order.slice(0, at))
    const after = into.findLastIndex(({ row }) => before.has(itemKey(row)))
    into.splice(after + 1, 0, entry)
  }
  return into
}

/** The words a card that went says in its slot (ADR 0098, S5c): where it
 * went, and when it wakes; none for a card gone to the Inbox or Working,
 * whose Mark says what it does now. */
export function wentWords(went: Went, now: number): string | undefined {
  switch (went.to) {
    case "deleted":
      return "Deleted"
    case "archived":
      return "Archived"
    case "later": {
      const when =
        went.until !== undefined
          ? clock(went.until, now)
          : went.someday
            ? "someday"
            : "when it's done"
      return `Later · ${when}`
    }
    default:
      if (went.from === "later") return "Woke"
      if (went.from === "archived") return "Unarchived"
      return undefined
  }
}

/** What is drawn, as its shape: the blocks, which cards are in each and
 * in which order, and which groups are folded. Two lists of one shape
 * draw every card in the same place. */
export function shapeOf(blocks: readonly Block[]): string {
  return blocks
    .map((block) => {
      if (block.kind === "rows")
        return `${block.key}[${block.rows.map(({ row }) => itemKey(row)).join(",")}]`
      return block.kind === "group" && block.folded
        ? `${block.key}-`
        : block.key
    })
    .join("|")
}

/** How long a list key holds the list, in ms. */
export const KEYS_HOLD = 2000

/** How long the list still holds after the last holder ended, in ms: a
 * pointer that crosses the list's edge and comes back keeps the same
 * hold. */
export const GRACE = 150

/** How long the card actions under the pointer take no click once the
 * rows below a slot an act by key closed have snapped up, in ms: the
 * next click meant for the card that went never lands on another's. */
export const QUIET = 250

/** The keys that hold the list while it has the focus, by their codes:
 * the pick's, opening, and the acts on a card. */
export const HOLDING_KEYS: ReadonlySet<string> = new Set([
  "ArrowUp",
  "ArrowDown",
  "Enter",
  "KeyS",
  "KeyZ",
  "KeyU",
  "KeyX",
  "F2",
])

/** What holds the list now. */
export type Holders = {
  /** The pointer is over the list. */
  pointer: boolean
  /** The popups anchored in the list that are open. */
  popups: number
  /** The list is in check mode (S10b). */
  checking: boolean
  /** When the last of those ended. */
  ended: number
  /** When a list key was last pressed. */
  keyed: number
  /** The window is blurred or hidden: nothing holds, until the pointer
   * comes back over the list. */
  away: boolean
}

export const NO_HOLDERS: Holders = {
  pointer: false,
  popups: 0,
  checking: false,
  ended: -Infinity,
  keyed: -Infinity,
  away: false,
}

const lasting = ({ pointer, popups, checking }: Holders) =>
  pointer || popups > 0 || checking

/** `holders` with `change` made at `now`: when the last of the pointer,
 * the popups and check mode ends, it ends then. */
export function holdersAfter(
  holders: Holders,
  change: Partial<Holders>,
  now: number
): Holders {
  const next = { ...holders, ...change }
  return lasting(holders) && !lasting(next) ? { ...next, ended: now } : next
}

/** Until when `holders` hold the list: for good while one lasts, else
 * until the grace after the last ended or the last key's hold. */
export function heldUntil(holders: Holders): number {
  if (holders.away) return -Infinity
  if (lasting(holders)) return Infinity
  return Math.max(holders.ended, holders.keyed + KEYS_HOLD) + GRACE
}
