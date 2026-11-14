/**
 * A sidebar card as one model (ADR 0098, decisions 8 and 27): from a
 * Thread, the place it is drawn in and how the list is grouped, its three
 * lines, each a left and a right; the colour of its call; how quiet it
 * is; and its time. `CardView.tsx` only draws it, and `spokenOf`
 * says it to a screen reader. Pure, with no clock of its own: a time is a
 * moment and a kind, put into words as it is drawn, against the minute
 * the cards are drawn as of (`useMinute`).
 */
import type { ProjectSummary } from "@banda/contract"
import type { DoingKind } from "@banda/contract/agents"
import type { Named } from "@banda/contract/machines"
import type { GroupBy } from "@banda/contract/sidebar"
import type { Checks, Pull } from "@banda/contract/pulls"
import { type CallColor, callColor } from "@banda/ui/components/banda-mark"
import { type MarkDoing, type MarkState, works } from "@banda/ui/lib/mark-state"
import { type Listed, NO_REASON } from "@banda/ui/pane"
import { projectLabel } from "@banda/ui/lib/projects"
import { dayOf } from "@banda/core"
import { agoOf, hourOf, short, wakes } from "@banda/ui/lib/words"
import {
  type Does,
  doesOf,
  lookOf,
  type Stand,
  STAND_WORDS,
} from "@banda/ui/status"
import type { Row } from "./rows"
import type { Child } from "./inbox"
import type { OnRow } from "./machine-on-row"

/** How the list is viewed, as its cards take it: grouped by Project
 * (decision 7), a group's header names the Project its cards then leave
 * out. */
export type CardView = { group: GroupBy }

/** A call's colour (decision 8): on its mark and its time, and nowhere
 * else. */
export type Tone = CallColor

/** Line 2's word (decision 8), neutral, in the text's colour. */
export type Word = "Asks" | "Done" | "Failed" | "Woke"

/** How quiet a card is (decision 3): grey at work, asleep put off or
 * archived. */
export type Quiet = Exclude<Stand, "turn" | "open">

/** A time a card says, as a moment and a kind: how long ago, short and
 * still; when it wakes, or goes on past a usage limit, by the clock; or a
 * Later that keeps no time. */
export type Time =
  | { kind: "ago"; at: number; tone?: Tone }
  | { kind: "wakes"; at: number }
  | { kind: "goes on"; at: number }
  | { kind: "someday" }
  | { kind: "when done" }

/** Who put a Thread off, and when (decision 11). */
export type PutOff = { at: number; byAgent: boolean }

/** What a slot of a card draws. The title, the time and what its Agent
 * does are the card's own; the rest carry what they draw. */
export type Slot =
  | { kind: "mark"; look: MarkState }
  | { kind: "title" }
  | { kind: "time" }
  /** Line 2: a word and what it says, or who put it off and when. */
  | { kind: "says"; word?: Word; putOff?: PutOff; text?: string }
  /** Line 2 at work: what its Agent does (`CardModel.does`). */
  | { kind: "works" }
  /** Line 2's right: the lines its last work that ended added and
   * removed, in grey (decision 8). */
  | { kind: "diff"; added: number; removed: number }
  /** Line 2's right in its place, once the Thread links a pull request
   * (decision 8; F2): its number, or how many with `of`, and how the one
   * that most needs the Person stands. */
  | { kind: "pull"; number: number; of: number; state?: PullState }
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
  /** On line 3, that its machine is out of reach, and since when
   * (`CardModel.away`, `awayShort`): after a dot where the machine shows
   * before it, "arc · away 12m" (decision 18). */
  | { kind: "away"; dot: boolean }

export type Says = Extract<Slot, { kind: "says" }>

export type PullChip = Extract<Slot, { kind: "pull" }>

/** How a pull request stands, as its chip's glyph says it (F2): its
 * checks passed ✓, failed ✗ or run •; merged; closed. */
export type PullState = "passed" | "failed" | "running" | "merged" | "closed"

/** One line of a card: what stands at its left, and at its right. */
export type Line = { left: Slot[]; right: Slot[] }

export type CardModel = {
  /** Where its Thread stands now, which its words say. */
  stand: Stand
  /** The place it is drawn in, whose title's weight it keeps while the
   * pointer keeps the list's order (decision 6), even as its Thread
   * stands elsewhere. */
  place: Stand
  title: string
  /** Three (decision 8). */
  lines: Line[]
  /** The colour of its call, on its mark and its time. */
  tone?: Tone
  quiet?: Quiet
  time: Time
  /** What its Agent does, at work: what its Mark shows, line 2 says and
   * its time is at a usage limit (`timeShown`). Its card holds it as the
   * Mark holds what it shows (`heldDoing`), so they never disagree. */
  does?: Does
  /** What its sub-agents at work say, which line 2 says at work in place
   * of what its turn does (ADR 0103, decision 32): "3 sub-agents at
   * work", "Waiting on Explore". */
  subagents?: string
  /** The Window last heard its machine at `since`, while it does not
   * reach it, away or stopped: its time stands as it was then. */
  away?: { since: number; machine?: string; stopped?: true }
  /** It stands on a free workspace, away from its Project's (ADR 0102,
   * decision 6). */
  strayed?: true
  /** Its Agent put it off, as it stands in Later (ADR 0074, decision
   * 10). */
  byAgent?: true
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
  strayed?: boolean
  /** Its parent, when another Agent started it (`inbox.ts`). */
  child?: Child
}

/** Each call's word, by its colour. */
const WORDS: Readonly<Record<Tone, Word>> = {
  attention: "Asks",
  destructive: "Failed",
  added: "Done",
  woke: "Woke",
}

/** The word of `listed`'s call at `now`, as its card says it; none for
 * one that calls no one. */
export function callWordOf(listed: Listed, now: number): Word | undefined {
  const tone = callColor(lookOf(listed, now).look)
  return tone && WORDS[tone]
}

/** The card of `input`. */
export function cardOf(input: CardOf): CardModel {
  const { row, place, at, now, view, machine, away, stopped, strayed } = input
  const { child } = input
  const { listed, stand } = row
  const { look } = lookOf(listed, now)
  const does = works(look) ? doesOf(listed, now) : undefined
  const subagents = does && subagentsSaid(does, listed.subagents?.said)
  const tone = callColor(look)
  // Line 2's right: its pull requests, once it links one (F2); else the
  // diff of its last work that ended, but at work, where the work since
  // has none yet. Failed's stays empty (decision 8).
  const failed = tone === "destructive"
  const pulls = failed ? undefined : listed.pulls
  const changed = does || failed ? undefined : listed.changedLines
  const lines: Line[] = [
    {
      left: [{ kind: "mark", look }, { kind: "title" }],
      right: [{ kind: "time" }],
    },
    {
      left: [does ? { kind: "works" } : saysOf(row, tone && WORDS[tone])],
      right: pulls?.[0]
        ? [pullSlot(pulls[0], pulls.length)]
        : changed
          ? [{ kind: "diff", ...changed }]
          : [],
    },
    {
      left: child
        ? [{ kind: "parent", title: child.parent }]
        : view.group === "project"
          ? []
          : [{ kind: "project", project: row.project }],
      right: [
        ...(machine ? [machineSlot(row, machine)] : []),
        ...(away === undefined
          ? []
          : [{ kind: "away" as const, dot: !!machine }]),
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
    },
  ]
  const quiet = stand === "turn" || stand === "open" ? undefined : stand
  return {
    stand,
    place,
    title: listed.title,
    lines,
    ...(tone ? { tone } : {}),
    ...(quiet ? { quiet } : {}),
    time: timeOf(row, at, tone),
    ...(does ? { does } : {}),
    ...(subagents ? { subagents } : {}),
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
    ...(stand === "later" && listed.later?.byAgent
      ? { byAgent: true as const }
      : {}),
    ...(child ? { child } : {}),
  }
}

/** `machine`'s slot on `row`'s card: by its name too, unless it shows by
 * its icon `alone`. */
function machineSlot(
  { host }: Pick<Row, "host">,
  { alone, ...machine }: OnRow
): Slot {
  return {
    kind: "machine",
    ...(host === undefined ? {} : { host }),
    machine,
    named: !alone,
  }
}

/** The chip of a Thread's `of` pull requests (F2): the `first`, which
 * the pulls App lists as the one that most needs the Person (ADR 0076,
 * decision 6), gives its glyph to them all. */
function pullSlot(first: Pull, of: number): Slot {
  const state = pullStateOf(first)
  return { kind: "pull", number: first.number, of, ...(state && { state }) }
}

/** How `pull` stands, by GitHub's last read: merged or closed, else its
 * checks summed up (ADR 0076, decision 2). None before it was read, or
 * with no checks. */
export function pullStateOf({ snapshot }: Pull): PullState | undefined {
  if (snapshot?.state === "merged" || snapshot?.state === "closed")
    return snapshot.state
  return snapshot?.checks && CHECKS[snapshot.checks]
}

/** Each sum of a pull request's checks, as its chip says it. */
const CHECKS: Readonly<Record<Checks, PullState>> = {
  passing: "passed",
  failing: "failed",
  running: "running",
}

/** What a pull request's chip shows at its state's place: a glyph for its
 * checks, a word once it landed. Only it takes a colour (F2). */
export const PULL_GLYPHS: Readonly<Record<PullState, string>> = {
  passed: "✓",
  failed: "✗",
  running: "•",
  merged: "merged",
  closed: "closed",
}

/** The words of a pull request's chip: `#1061`, or `3 PRs`. */
export const pullWords = ({ number, of }: PullChip) =>
  of > 1 ? `${of} PRs` : `#${number}`

/** What a screen reader hears of each state: "checks passed". */
const PULL_SAID: Readonly<Record<PullState, string>> = {
  passed: "checks passed",
  failed: "checks failed",
  running: "checks running",
  merged: "merged",
  closed: "closed",
}

/**
 * Line 2 (decision 8, §2.6) where no Agent works: a call's word and what
 * it says, the question, why it failed or the done note, never in a
 * colour; Woke, who put it off and when, and what it said; else what it
 * was last asked. Done's first sentence of the last reply, where no note
 * is, comes with its own PR.
 */
function saysOf({ listed }: Pick<Row, "listed">, word: Word | undefined): Says {
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

/** What line 2 says of a doing that works on nothing named (§2.6). */
const SAID: Partial<Record<MarkDoing, string>> = {
  think: "Thinks",
  reply: "Writes to you",
  compacting: "Compacting the context",
}

/** How line 2 says each kind of what a turn does to what it works on
 * (§2.6); a command, and a tool with no words of its own, is said by
 * what it works on alone. */
const VERBS: Partial<Record<DoingKind, (on: string) => string>> = {
  edit: (on) => `Edits ${on}`,
  read: (on) => `Reads ${on}`,
  search: (on) => `Searches “${on}”`,
  fetch: (on) => `Fetches ${on}`,
  delete: (on) => `Deletes ${on}`,
  move: (on) => `Moves ${on}`,
}

/**
 * What a working card says its Agent does at `now` (ADR 0098, decision 8;
 * §2.6), in `doesOf`'s order: "Usage limit · goes on at 15:00"; "No
 * events for 6m", by `ago`'s words for how long; "Compacting the
 * context"; what its turn does, "pnpm test", "Edits Row.tsx"; or, with
 * nothing named yet, that it works.
 */
export function worksWords(
  { doing, kind, on, at }: Does,
  now: number,
  ago: (at: number, now: number) => string = short
): string {
  // Only a limit and silence have a moment.
  if (at !== undefined)
    return doing === "limit"
      ? `Usage limit · goes on at ${wakes(at, now)}`
      : `No events for ${ago(at, now)}`
  const said = SAID[doing]
  if (said) return said
  if (on === undefined) return "Working"
  const verb = kind && VERBS[kind]
  return verb ? verb(on) : on
}

/** What line 2 says of the sub-agents at work, `said`, while its Agent
 * `does` what it does (ADR 0103, decision 32): before what its turn does,
 * as it says more, but after a usage limit and no events, which say that
 * the work does not go on. */
function subagentsSaid(does: Does, said?: string): string | undefined {
  return does.doing === "limit" || does.doing === "stuck" ? undefined : said
}

/** What line 2 says at work, as `card` holds it at `now`: its sub-agents
 * at work, or what its Agent does (`worksWords`). */
export function workSaid(
  card: CardModel,
  now: number,
  ago?: (at: number, now: number) => string
): string {
  if (card.subagents) return card.subagents
  return card.does ? worksWords(card.does, now, ago) : ""
}

/** The time `card` shows: at a usage limit, when it goes on (decision
 * 8); else its own. */
export function timeShown({ does, time }: CardModel): Time {
  return does?.doing === "limit" && does.at !== undefined
    ? { kind: "goes on", at: does.at }
    : time
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

/** A card as a screen reader says it (§2.8): its name and what describes
 * it. */
export type Spoken = { name: string; description: string }

/** What a card that strayed from its Project's workspace says (ADR 0102,
 * decision 6): its diamond's tooltip, and to a screen reader. */
export const STRAYED = "Away from its Project's workspace"

/** What a card in Later says of a Thread its Agent put off (ADR 0074:
 * "the Agent's own snooze shows as the Agent's"), to a screen reader and
 * on its Wake. */
export const LATER_BY_AGENT = "Later by its Agent"

/** Each place's word, where no call says one. */
const STAND_SAID: Readonly<Record<Stand, string>> = {
  ...STAND_WORDS,
  archived: "Archived",
}

/**
 * How `card` is said at `now` (§2.8): its name is its title, its word,
 * "Later by its Agent" where its Agent put it off, and its time in full
 * ("14 minutes", never "14m", which a reader may say as metres); its
 * description, what its Agent does at work, as its Mark shows it there,
 * then what its other lines say, each `·` a full stop, ✓ "passed" and ✗
 * "failed"; then that it strayed from its Project's workspace, who
 * started it if another Agent did, and that its machine is away.
 */
export function spokenOf(card: CardModel, now: number): Spoken {
  const word = card.tone
    ? WORDS[card.tone]
    : card.byAgent
      ? LATER_BY_AGENT
      : STAND_SAID[card.stand]
  const at = card.away?.since ?? now
  const name = [card.title, word, timeSaid(timeShown(card), at)].join(", ")
  const said = card.does ? [workSaid(card, at, agoSaid)] : []
  for (const line of card.lines)
    for (const slot of [...line.left, ...line.right])
      said.push(...slotSaid(slot, at))
  if (card.strayed) said.push(STRAYED)
  if (card.child) said.push(`Started by ${card.child.parent}`)
  if (card.away)
    said.push(
      `${card.away.machine ?? "Its machine"} is ${card.away.stopped ? "stopped" : "away"}, ${agoSaid(card.away.since, now)}`
    )
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
    case "diff":
      return [
        `${slot.added} ${slot.added === 1 ? "line" : "lines"} added, ${slot.removed} removed`,
      ]
    case "pull": {
      // "Pull request 1061, checks passed"; with several, how many first,
      // then how the one that most needs the Person stands.
      const state = slot.state && PULL_SAID[slot.state]
      const one = `Pull request ${slot.number}${state ? `, ${state}` : ""}`
      if (slot.of === 1) return [one]
      return [`${slot.of} pull requests${state ? ` · ${one}` : ""}`]
    }
    // Said with who started it, and that its machine is away, after the
    // lines.
    case "away":
    case "parent":
    case "mark":
    case "title":
    case "time":
    case "works":
      return []
  }
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

/** When `at` is, in full, as `wakes` says it short: "at 18:30", "Friday
 * at 9:00", "December 3". */
function clockSaid(at: number, now: number): string {
  switch (dayOf(at, now)) {
    case "today":
      return `at ${hourOf(at)}`
    case "week":
      return `${WEEKDAY.format(at)} at ${hourOf(at)}`
    case "date":
      return MONTH_DAY.format(at)
  }
}

/** When `at` wakes, in full. */
const wakesSaid = (at: number, now: number) => `wakes ${clockSaid(at, now)}`

/** A card's time, in full. */
function timeSaid(time: Time, now: number): string {
  switch (time.kind) {
    case "ago":
      return agoSaid(time.at, now)
    case "wakes":
      return wakesSaid(time.at, now)
    case "goes on":
      return `goes on ${clockSaid(time.at, now)}`
    case "someday":
      return "someday"
    case "when done":
      return "when it's done"
  }
}
