/**
 * A sidebar card as one model (ADR 0098, decisions 8, 9 and 27): from a
 * Thread, the place it is drawn in and how the list is viewed, its lines,
 * each a left and a right; the colour of its call; how quiet it is; and
 * its time. `CardView.tsx` and the counts' list only draw it, and `spokenOf`
 * says it to a screen reader. Pure, with no clock of its own: a time is a
 * moment and a kind, put into words as it is drawn, against the list's
 * clock (`clock.ts`).
 */
import type { ProjectSummary } from "@banda/contract"
import type { Named } from "@banda/contract/machines"
import { type CallColor, callColor } from "@banda/ui/components/banda-mark"
import type { MarkState } from "@banda/ui/lib/mark-state"
import { NO_REASON } from "@banda/ui/pane"
import { projectLabel } from "@banda/ui/lib/projects"
import { dayOf } from "@banda/core"
import { agoOf, hourOf } from "@banda/ui/lib/words"
import { lookOf, type Stand, STAND_WORDS } from "@banda/ui/status"
import type { Placed, Row } from "./rows"
import { type Went, wentWords } from "./hold"
import { atOf, type Child } from "./inbox"
import type { OnRow } from "./machine-on-row"

/** How many lines a card draws (decision 9): by where it is, or as many
 * as the Person set. */
export type Density = "auto" | 1 | 2 | 3

/** What the list is grouped by (decision 7): a group's header names what
 * its cards then leave out. */
export type Grouped = "none" | "project" | "machine"

/** How the list is viewed, as its cards take it. */
export type CardView = { density: Density; group: Grouped }

/** A call's colour (decision 8): on its mark and its time, and nowhere
 * else. */
export type Tone = CallColor

/** Line 2's word (decision 8), neutral, in the text's colour. */
export type Word = "Asks" | "Done" | "Failed" | "Woke"

/** How quiet a card is (decision 3): grey at work, asleep put off or
 * archived. */
export type Quiet = Exclude<Stand, "turn" | "open">

/** A time a card says, as a moment and a kind: how long ago, short and
 * still; when it wakes, by the clock; or a Later that keeps no time. */
export type Time =
  | { kind: "ago"; at: number; tone?: Tone }
  | { kind: "wakes"; at: number }
  | { kind: "someday" }
  | { kind: "when done" }

/** Who put a Thread off, and when (decision 11). */
export type PutOff = { at: number; byAgent: boolean }

/** What a slot of a card draws. The title and the time are the card's
 * own; the rest carry what they draw. */
export type Slot =
  | { kind: "mark"; look: MarkState }
  | { kind: "title" }
  | { kind: "time" }
  /** Line 2: a word and what it says, or who put it off and when. */
  | { kind: "says"; word?: Word; putOff?: PutOff; text?: string }
  /** Its Project's sign and name, on line 3. */
  | { kind: "project"; project: ProjectSummary }
  /** In the Project's place on line 3, a child's parent: ↳ and its
   * title (decision 24). */
  | { kind: "parent"; title: string }
  /** The machine it runs on: its icon, and on line 3 its name unless the
   * Person asked for its icon alone; another machine's by its `host`. */
  | { kind: "machine"; host?: string; machine: Named; named: boolean }
  /** Its Harness's emblem. */
  | { kind: "harness"; id: string; name: string }

export type Says = Extract<Slot, { kind: "says" }>

/** One line of a card: what stands at its left, and at its right. */
export type Line = { left: Slot[]; right: Slot[] }

export type CardModel = {
  /** Where its Thread stands now, which its words say. */
  stand: Stand
  /** The place it is drawn in, whose lines it keeps while the list holds
   * (decision 6), even as its Thread stands elsewhere. */
  place: Stand
  title: string
  /** One to three. */
  lines: Line[]
  /** The colour of its call, on its mark and its time. */
  tone?: Tone
  quiet?: Quiet
  time: Time
  /** It left the tab while the list held: where it went, shown in its
   * time's place (nothing where its Mark says it), and as a screen reader
   * hears it. */
  gone?: { words: string; said: string }
  /** The Window last heard its machine at `since`, while it does not
   * reach it, away or stopped: its time stands as it was then. */
  away?: { since: number; machine?: string; stopped?: true }
  /** It stands on a free workspace, away from its Project's (ADR 0102,
   * decision 6). */
  strayed?: true
  /** Another Agent started it: its parent, and whether it sits under it,
   * ↳ before its mark and its lines in by as much (decision 24). */
  child?: Child
}

/** What a card is made from. */
export type CardOf = {
  row: Row
  /** The place it is drawn in. */
  place: Stand
  /** When its time counts from there (`inbox.ts`, §2.5). */
  at: number
  /** The Later clock its row stands by, which its look is read by. */
  now: number
  view: CardView
  /** The machine it runs on, as its row is given it (`machineOnRow`):
   * another's, or this one's where the Person asked; none under a label
   * that names it, or with `off`. */
  machine?: OnRow
  /** As of when its machine was last heard, while the Window does not
   * reach it. */
  away?: number
  /** That machine is stopped, not away. */
  stopped?: boolean
  /** Where it went, if it left the tab while the list held. */
  went?: Went
  strayed?: boolean
  /** Its parent, when another Agent started it (`inbox.ts`). */
  child?: Child
}

/** The lines a card of `place` draws, in `view` (decision 9): auto, three
 * in Your turn, two there when grouped by Project, whose header names it,
 * unless a `child`'s line 3 names its parent; and one for the rest. */
export function linesOf(
  place: Stand,
  { density, group }: CardView,
  child?: Child
): 1 | 2 | 3 {
  if (density !== "auto") return density
  if (place !== "turn") return 1
  return group === "project" && !child ? 2 : 3
}

/** Each call's word, by its colour. */
const WORDS: Readonly<Record<Tone, Word>> = {
  attention: "Asks",
  destructive: "Failed",
  added: "Done",
  woke: "Woke",
}

/** The card of `input`. */
export function cardOf(input: CardOf): CardModel {
  const { row, place, at, now, view, machine, away, stopped, went, strayed } =
    input
  const { child } = input
  const { listed, stand } = row
  const { look } = lookOf(listed, now)
  const tone = callColor(look)
  const count = linesOf(place, view, child)
  // The machine stands on line 3; with none, on line 1's right, by its
  // icon. Grouped by machine, its header names it.
  const on = view.group === "machine" ? undefined : machine
  const lines: Line[] = [
    {
      left: [{ kind: "mark", look }, { kind: "title" }],
      right: [
        ...(on && count < 3 ? [machineSlot(row, on, false)] : []),
        { kind: "time" },
      ],
    },
  ]
  if (count >= 2)
    // Its right waits for the PR and the diff (F1b, F2); Failed's stays
    // empty (decision 8).
    lines.push({ left: [saysOf(row, tone && WORDS[tone])], right: [] })
  if (count >= 3)
    lines.push({
      left: child
        ? [{ kind: "parent", title: child.parent }]
        : view.group === "project"
          ? []
          : [{ kind: "project", project: row.project }],
      right: [
        ...(on ? [machineSlot(row, on, true)] : []),
        ...(listed.harness
          ? [
              {
                kind: "harness" as const,
                id: listed.harness,
                name: listed.by ?? listed.harness,
              },
            ]
          : []),
      ],
    })
  const quiet = stand === "turn" || stand === "open" ? undefined : stand
  return {
    stand,
    place,
    title: listed.title,
    lines,
    ...(tone ? { tone } : {}),
    ...(quiet ? { quiet } : {}),
    time: timeOf(row, at, tone),
    ...(went
      ? {
          gone: {
            words: wentWords(went, now) ?? "",
            said: wentSaid(went, now),
          },
        }
      : {}),
    ...(away === undefined
      ? {}
      : {
          away: {
            since: away,
            ...(machine ? { machine: machine.name } : {}),
            ...(stopped ? { stopped: true as const } : {}),
          },
        }),
    ...(strayed ? { strayed: true as const } : {}),
    ...(child ? { child } : {}),
  }
}

/** `machine`'s slot on `row`'s card: by its name too where `named`, unless
 * it shows by its icon `alone`. */
function machineSlot(
  { host }: Row,
  { alone, ...machine }: OnRow,
  named: boolean
): Slot {
  return {
    kind: "machine",
    ...(host === undefined ? {} : { host }),
    machine,
    named: named && !alone,
  }
}

/**
 * Line 2 (decision 8, §2.6): a call's word and what it says, the
 * question, why it failed or the done note, never in a colour; Woke, who
 * put it off and when, and what it said; else what it was last asked. A
 * working card's own words come with ADR 0099's step 3, and Done's first
 * sentence of the last reply, where no note is, with its own PR.
 */
function saysOf({ listed }: Row, word: Word | undefined): Says {
  const { calls, said, later } = listed
  switch (word) {
    case "Asks":
    case "Done":
      return { kind: "says", word, ...(calls ? { text: calls } : {}) }
    case "Failed":
      // With no reason, the word says all there is.
      return {
        kind: "says",
        word,
        ...(calls && calls !== NO_REASON ? { text: calls } : {}),
      }
    case "Woke":
      return {
        kind: "says",
        word,
        ...(later
          ? { putOff: { at: later.at, byAgent: !!later.byAgent } }
          : {}),
        ...(calls ? { text: calls } : {}),
      }
    case undefined: {
      const text = calls ?? said
      return { kind: "says", ...(text ? { text } : {}) }
    }
  }
}

/** What line 2 says past its word: who put it off and how long ago, by
 * `ago`'s words for that, then what it says. */
export function saysWords(
  { putOff, text }: Says,
  ago: (at: number) => string
): string {
  const words = putOff && ago(putOff.at)
  const off =
    putOff &&
    `${putOff.byAgent ? "Its Agent" : "You"} put it off ${words === "now" ? "just now" : `${words} ago`}`
  return [off, text].filter(Boolean).join(" · ")
}

/** The time a Thread that stands as `row` says, counted from `at` (§2.5):
 * how long ago, in its call's `tone`; put off, when it wakes. */
export function timeOf(
  { listed, stand }: Pick<Row, "listed" | "stand">,
  at: number,
  tone?: Tone
): Time {
  if (stand === "later") {
    const { later } = listed
    if (later?.until !== undefined) return { kind: "wakes", at: later.until }
    return later?.someday ? { kind: "someday" } : { kind: "when done" }
  }
  return { kind: "ago", at, ...(tone ? { tone } : {}) }
}

/** The time `placed`'s card says, where no card draws it, as in the
 * counts' list: from its place's moment, in the colour of `look`. */
export function timeAt(placed: Placed, look: MarkState): Time {
  return timeOf(placed, atOf(placed), callColor(look))
}

/** Every time `card` says that changes as time goes by: its own and when
 * it was put off, unless they stand as of when its machine was last
 * heard; and how long that has been. */
export function timesOf(card: CardModel): Time[] {
  if (card.away) return [{ kind: "ago", at: card.away.since }]
  const times: Time[] = [card.time]
  for (const line of card.lines)
    for (const slot of [...line.left, ...line.right])
      if (slot.kind === "says" && slot.putOff)
        times.push({ kind: "ago", at: slot.putOff.at })
  return times
}

/** A card as a screen reader says it (§2.8): its name and what describes
 * it. */
export type Spoken = { name: string; description: string }

/** What a card that strayed from its Project's workspace says (ADR 0102,
 * decision 6): its diamond's tooltip, and to a screen reader. */
export const STRAYED = "Away from its Project's workspace"

/** Each place's word, where no call says one. */
const STAND_SAID: Readonly<Record<Stand, string>> = {
  ...STAND_WORDS,
  archived: "Archived",
}

/**
 * How `card` is said at `now` (§2.8): its name is its title, its word and
 * its time in full ("14 minutes", never "14m", which a reader may say as
 * metres); its description, what its other lines say, each `·` a full
 * stop, ✓ "passed" and ✗ "failed"; then that it strayed from its
 * Project's workspace, who started it if another Agent did, that its
 * machine is away, and where it went if it left the tab.
 */
export function spokenOf(card: CardModel, now: number): Spoken {
  const word = card.tone ? WORDS[card.tone] : STAND_SAID[card.stand]
  const at = card.away?.since ?? now
  const name = [card.title, word, timeSaid(card.time, at)].join(", ")
  const said = card.lines.flatMap((line) =>
    [...line.left, ...line.right].flatMap((slot) => slotSaid(slot, at))
  )
  if (card.strayed) said.push(STRAYED)
  if (card.child) said.push(`Started by ${card.child.parent}`)
  if (card.away)
    said.push(
      `${card.away.machine ?? "Its machine"} is ${card.away.stopped ? "stopped" : "away"}, ${agoSaid(card.away.since, now)}`
    )
  if (card.gone) said.push(card.gone.said)
  return { name, description: sentences(said) }
}

/** `parts` as sentences: each `·` ends one, as does each part, unless it
 * ends itself; ✓ is read "passed" and ✗ "failed". */
function sentences(parts: readonly string[]): string {
  return parts
    .flatMap((part) => part.split("·"))
    .map((part) => part.trim().replace(/✓/g, "passed").replace(/✗/g, "failed"))
    .filter(Boolean)
    .reduce(
      (all, part) =>
        all ? `${all}${/[.?!]$/.test(all) ? "" : "."} ${part}` : part,
      ""
    )
}

/** What a slot says, past the title, the mark and the time. */
function slotSaid(slot: Slot, now: number): string[] {
  switch (slot.kind) {
    case "says": {
      const rest = saysWords(slot, (at) => agoSaid(at, now))
      const all = [slot.word, rest].filter(Boolean).join(" ")
      return all ? [all] : []
    }
    case "project":
      return [projectLabel(slot.project)]
    case "machine":
      return [slot.machine.name]
    case "harness":
      return [slot.name]
    // Said with who started it, after the lines.
    case "parent":
    case "mark":
    case "title":
    case "time":
      return []
  }
}

/** Where a card that left the tab went, as a screen reader hears it
 * (§2.8): "moved to Archive", "moved to Later, wakes at 18:30". */
export function wentSaid(went: Went, now: number): string {
  if (went.to === "deleted") return "Deleted"
  const moved = `Moved to ${STAND_WORDS[went.to]}`
  if (went.to !== "later") return moved
  if (went.until !== undefined) return `${moved}, ${wakesSaid(went.until, now)}`
  return went.someday ? `${moved}, someday` : `${moved}, until it's done`
}

const MONTH_DAY = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
})
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
})
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long" })

/** `n` of `unit`, its plural past one. */
const many = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`

/** How long ago `at` was, in full, by the steps `short` takes. */
export function agoSaid(at: number, now: number): string {
  const ago = agoOf(at, now)
  switch (ago.kind) {
    case "now":
      return "now"
    case "count":
      return many(ago.count, ago.word)
    case "date":
      return (ago.thisYear ? MONTH_DAY : MONTH_YEAR).format(at)
  }
}

/** When `at` wakes, in full, as `wakes` says it short. */
function wakesSaid(at: number, now: number): string {
  switch (dayOf(at, now)) {
    case "today":
      return `wakes at ${hourOf(at)}`
    case "week":
      return `wakes ${WEEKDAY.format(at)} at ${hourOf(at)}`
    case "date":
      return `wakes ${MONTH_DAY.format(at)}`
  }
}

/** A card's time, in full. */
function timeSaid(time: Time, now: number): string {
  switch (time.kind) {
    case "ago":
      return agoSaid(time.at, now)
    case "wakes":
      return wakesSaid(time.at, now)
    case "someday":
      return "someday"
    case "when done":
      return "when it's done"
  }
}
