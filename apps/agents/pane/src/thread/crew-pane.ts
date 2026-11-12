/**
 * The Crew Pane, as it words a Crew (ADR 0103, decision 22; mock 03): its
 * summary of counts, clock and tokens; the filter; the phases as columns
 * when the Pane is wide and as bands when it is narrow; the Timeline; an
 * agent's detail; and when it opens by itself. The same for every client
 * (ADR 0089, decision 1); the views draw what this says. Pure, so plain
 * tests cover it. Banda shows a Crew and stops none of it (call 11).
 */
import type { Crew, CrewAgent } from "@banda/contract/agents"
import { SATELLITE_WORDS, type SatelliteState } from "@banda/ui/lib/satellite"
import { duration, hourOf } from "@banda/ui/lib/words"
import { firstLine } from "../entries/parts/messageText"
import {
  countWords,
  footOf,
  footWords,
  lookOfAgent,
  plural,
  tally,
} from "./crew"
import type { Count } from "./subagents"

/** From this width up the phases are columns; narrower, bands. */
export const WIDE = 760

/** What the filter keeps: every agent, or those that work, ask or
 * failed. */
export type Filter = "all" | "working" | "asks" | "failed"

/** The filter's choices, in order, with their words. */
export const FILTERS: readonly { id: Filter; words: string }[] = [
  { id: "all", words: "All" },
  { id: "working", words: "Working" },
  { id: "asks", words: "Asks" },
  { id: "failed", words: "Failed" },
]

/** Whether `filter` keeps `agent`. */
export function keeps(filter: Filter, agent: CrewAgent): boolean {
  switch (filter) {
    case "all":
      return true
    case "working":
      return agent.state === "running"
    case "asks":
      return agent.state === "asks"
    case "failed":
      return agent.state === "failed"
  }
}

/** An agent's key, by its phase and its index there: "2.4". */
export function keyOf(agent: { phase: number; index: number }): string {
  return `${agent.phase}.${agent.index}`
}

/** The agent `key` names, if the Crew has it. */
export function agentOf(crew: Crew, key: string): CrewAgent | undefined {
  return crew.agents.find((agent) => keyOf(agent) === key)
}

/** Tokens, short: "812", "48.2k", "1.4M". */
export function tokenWords(tokens: number): string {
  const one = (n: number) => n.toFixed(1).replace(/\.0$/, "")
  if (tokens < 1000) return String(tokens)
  if (tokens < 999_950) return `${one(tokens / 1000)}k`
  return `${one(tokens / 1_000_000)}M`
}

/** The summary line: "9 agents · 2 working · 1 asks · 5 done · 1 failed",
 * the failed alone in red and Asks in the attention's colour; once ended,
 * as the card's foot says it; and its tokens. The clock is apart: it
 * ticks (decision 20). */
export type Summary = { counts: Count[]; tokens?: string }

export function summaryOf(crew: Crew): Summary {
  const counts =
    crew.state === "working"
      ? [
          { words: plural(crew.agents.length, "agent") },
          ...countWords(tally(crew.agents)),
        ]
      : footOf(crew).counts
  return {
    counts,
    ...(crew.tokens !== undefined && {
      tokens: `${tokenWords(crew.tokens)} tokens`,
    }),
  }
}

/** The Pane's one clock (decision 20): how long it has worked at `now`,
 * or how long it took. None once Lost: no time goes by for it. */
export function clockOf(crew: Crew, now: number): string | undefined {
  if (crew.state === "lost" || crew.state === "stopped") return undefined
  return duration((crew.ended ?? now) - crew.started)
}

/** One agent as a column's or a band's row says it. Its time does not
 * tick (decision 20). */
export type Row = {
  key: string
  phase: number
  index: number
  label: string
  look: SatelliteState
  /** How long it took, or has worked so far at the time it is drawn. */
  time?: string
  /** Under its label: why it failed, what it gave back, what it does,
   * or that it waits. */
  line?: string
  /** Its try, when it is not the first. */
  attempt?: number
}

/** The first line of `text` as words: none for JSON, which its detail
 * writes out. */
function said(text: string | undefined): string | undefined {
  const line = firstLine(text)
  return line && !/^[[{]/.test(line.trim()) ? line : undefined
}

/** What `agent` says as a row at `now`. */
export function rowOf(agent: CrewAgent, now: number): Row {
  const look = lookOfAgent(agent)
  const took =
    agent.took ??
    (agent.started !== undefined && (look === "working" || look === "asks")
      ? now - agent.started
      : undefined)
  const line =
    look === "queued"
      ? "Waiting for a slot"
      : look === "asks"
        ? "Asks"
        : look === "failed" || look === "stopped" || look === "lost"
          ? firstLine(agent.why) || SATELLITE_WORDS[look]
          : look === "done"
            ? (said(agent.result) ?? agent.last)
            : agent.last
  return {
    key: keyOf(agent),
    phase: agent.phase,
    index: agent.index,
    label: agent.label.trim() || `Agent ${agent.index}`,
    look,
    ...(took !== undefined && { time: duration(took) }),
    ...(line && { line }),
    ...(agent.attempt > 1 && { attempt: agent.attempt }),
  }
}

/** A phase's head, in a column or a band: its name, what its script's
 * `meta` says it does and the model its agents share, and its agents done
 * of those called so far. */
export type PhaseHead = {
  index: number
  title: string
  /** "read each route · Haiku". */
  about?: string
  /** "4/7"; none before any agent of it was called. */
  count?: string
  /** Not reached yet: no agent of it called. */
  waits: boolean
}

function headOf(crew: Crew, index: number): PhaseHead {
  const phase = crew.phases.find((one) => one.index === index)
  const agents = crew.agents.filter((agent) => agent.phase === index)
  const models = new Set(agents.map((agent) => agent.model).filter(Boolean))
  const model = models.size === 1 ? [...models][0] : undefined
  const about = [phase?.detail, model].filter(Boolean).join(" · ")
  const done = agents.filter((agent) => agent.state === "done").length
  return {
    index,
    title: phase?.title ?? `Phase ${index}`,
    ...(about && { about }),
    ...(agents.length > 0 && { count: `${done}/${agents.length}` }),
    waits: agents.length === 0,
  }
}

/** The phases a Crew has: those its script named, and any its agents name
 * that it did not, in order. */
function phasesOf(crew: Crew): number[] {
  const all = new Set(crew.phases.map((phase) => phase.index))
  for (const agent of crew.agents) all.add(agent.phase)
  return [...all].sort((a, b) => a - b)
}

/** A phase as a column: its head and the rows the filter keeps, by their
 * index there, so a pipeline's agent keeps its row from phase to phase
 * (amended 2026-11-12). */
export type Column = PhaseHead & { rows: Row[] }

export function columnsOf(crew: Crew, filter: Filter, now: number): Column[] {
  return phasesOf(crew).map((index) => ({
    ...headOf(crew, index),
    rows: crew.agents
      .filter((agent) => agent.phase === index && keeps(filter, agent))
      .sort((a, b) => a.index - b.index)
      .map((agent) => rowOf(agent, now)),
  }))
}

/** The order a band's rows go in: what calls for the Person first. */
const BAND_ORDER: Record<SatelliteState, number> = {
  asks: 0,
  failed: 1,
  working: 2,
  stopped: 3,
  lost: 4,
  done: 5,
  queued: 6,
}

/** A phase as a band: its head; the rows that always show, those that
 * ask, then failed, then at work, then stopped or Lost; then, folded, "✓
 * 38 done", whose rows show once it is opened, and "6 waiting for a
 * slot". The filter keeps only its own rows, and folds none. */
export type Band = PhaseHead & {
  rows: Row[]
  /** The done agents, folded into one line. */
  done: Row[]
  /** How many wait for a slot. */
  waiting: number
}

export function bandsOf(crew: Crew, filter: Filter, now: number): Band[] {
  return phasesOf(crew).map((index) => {
    const agents = crew.agents
      .filter((agent) => agent.phase === index)
      .sort((a, b) => a.index - b.index)
    const rows = agents.map((agent) => rowOf(agent, now))
    const shown =
      filter === "all"
        ? rows.filter((row) => row.look !== "done" && row.look !== "queued")
        : agents.flatMap((agent, at) =>
            keeps(filter, agent) ? [rows[at]!] : []
          )
    return {
      ...headOf(crew, index),
      rows: shown.sort((a, b) => BAND_ORDER[a.look] - BAND_ORDER[b.look]),
      done: filter === "all" ? rows.filter((row) => row.look === "done") : [],
      waiting:
        filter === "all"
          ? rows.filter((row) => row.look === "queued").length
          : 0,
    }
  })
}

/** What a band's folded lines say. */
export const doneWords = (n: number) => `${n} done`
export const waitingWords = (n: number) => `${n} waiting for a slot`

/** The Timeline (decision 22): a lane an agent on one axis of time, from
 * the Crew's start to its end or now, phases as bands of lanes. Its axis
 * does not tick: only "now" moves, with the clock. */
export type Timeline = {
  /** The axis's marks, each where it falls, from 0 to 1. */
  ticks: { at: number; words: string }[]
  /** Where now is, from 0 to 1, while it works. */
  now?: number
  phases: (PhaseHead & { lanes: Lane[] })[]
}

/** One agent's lane: where it started and where it ended or is now, from
 * 0 to 1. */
export type Lane = {
  key: string
  label: string
  look: SatelliteState
  from: number
  to: number
  attempt?: number
}

/** Steps an axis may take, the first that gives at most this many marks. */
const STEPS = [
  1000, 2000, 5000, 10_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000,
  1_800_000, 3_600_000, 7_200_000,
]
const MOST_TICKS = 10

export function timelineOf(crew: Crew, filter: Filter, now: number): Timeline {
  const from = crew.started
  const elapsed = Math.max((crew.ended ?? now) - from, 1000)
  // Ended, the axis is its time; at work, it ends a whole step past now,
  // so it stays still while now moves along it.
  const working = crew.state === "working"
  const step =
    STEPS.find((one) => elapsed / one + (working ? 1 : 0) <= MOST_TICKS) ??
    STEPS[STEPS.length - 1]!
  const span = working ? (Math.floor(elapsed / step) + 1) * step : elapsed
  const end = from + span
  const at = (time: number) => Math.min(1, Math.max(0, (time - from) / span))
  const ticks = []
  for (let time = 0; time <= span; time += step)
    ticks.push({ at: time / span, words: time === 0 ? "0" : axisWords(time) })
  return {
    ticks,
    ...(working && { now: elapsed / span }),
    phases: phasesOf(crew).map((index) => ({
      ...headOf(crew, index),
      lanes: crew.agents
        .filter(
          (agent) =>
            agent.phase === index &&
            agent.started !== undefined &&
            keeps(filter, agent)
        )
        .sort((a, b) => a.index - b.index)
        .map((agent) => {
          const look = lookOfAgent(agent)
          const started = agent.started!
          const stop =
            agent.took !== undefined
              ? started + agent.took
              : look === "working" || look === "asks"
                ? Math.min(now, end)
                : started
          return {
            key: keyOf(agent),
            label: agent.label.trim() || `Agent ${agent.index}`,
            look,
            from: at(started),
            to: at(stop),
            ...(agent.attempt > 1 && { attempt: agent.attempt }),
          }
        }),
    })),
  }
}

/** An axis mark: "30s", "2m", "1h 30m". */
function axisWords(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (minutes < 60) return `${minutes}m`
  const rest = minutes % 60
  return `${Math.floor(minutes / 60)}h${rest ? ` ${rest}m` : ""}`
}

/** An agent's detail (decision 22): where it is, its facts, its brief,
 * what it last did and what it gave back. Its work, from Claude's
 * transcript, comes later (amended 2026-11-12). */
export type Detail = {
  key: string
  label: string
  look: SatelliteState
  /** The breadcrumb, from the Crew down: "audit-routes › Fix › share.ts". */
  crumbs: [string, string, string]
  facts: { name: string; value: string; look?: SatelliteState }[]
  brief?: string
  last?: string
  /** Why it failed or stopped. */
  why?: string
  result?: Result
}

/** What came back: as it is, or JSON, written out to read. */
export type Result = { text: string; json: boolean }

/** `text` as a Result: a JSON object or list written out, else as it is. */
export function resultOf(text: string): Result {
  const trimmed = text.trim()
  if (/^[[{]/.test(trimmed))
    try {
      return { text: JSON.stringify(JSON.parse(trimmed), null, 2), json: true }
    } catch {
      // Not JSON after all: the text as it came.
    }
  return { text, json: false }
}

export function detailOf(crew: Crew, agent: CrewAgent, now: number): Detail {
  const row = rowOf(agent, now)
  const phase = headOf(crew, agent.phase)
  const of = crew.agents.filter((one) => one.phase === agent.phase).length
  const facts: Detail["facts"] = [
    { name: "Phase", value: `${phase.title} · ${agent.index} of ${of}` },
    { name: "State", value: SATELLITE_WORDS[row.look], look: row.look },
    ...(row.time ? [{ name: "Time", value: row.time }] : []),
    ...(agent.model ? [{ name: "Model", value: agent.model }] : []),
    { name: "Attempt", value: String(agent.attempt) },
    ...(agent.tokens !== undefined
      ? [{ name: "Tokens", value: tokenWords(agent.tokens) }]
      : []),
  ]
  return {
    key: row.key,
    label: row.label,
    look: row.look,
    crumbs: [crew.title, phase.title, row.label],
    facts,
    ...(agent.prompt && { brief: agent.prompt }),
    ...(agent.last && { last: agent.last }),
    ...(agent.why && { why: agent.why }),
    ...(agent.result && { result: resultOf(agent.result) }),
  }
}

/** What stands over the summary once the Crew ended: done, its Result,
 * and when it went back to Claude; failed, why; Lost or stopped, why and
 * how many were done, and, Lost, Ask Claude to go on (decision 26). None
 * while it works. */
export type Ending =
  | { kind: "result"; result: Result; at: string }
  | { kind: "failed"; why: string }
  | { kind: "lost"; words: string; then?: string; goOn: boolean }

export function endingOf(crew: Crew, short: string): Ending | undefined {
  switch (crew.state) {
    case "working":
      return undefined
    case "done":
      return crew.result === undefined
        ? undefined
        : {
            kind: "result",
            result: resultOf(crew.result),
            at: hourOf(crew.ended ?? crew.started),
          }
    case "failed":
      return { kind: "failed", why: firstLine(crew.why) || "It failed." }
    case "stopped":
    case "lost": {
      const foot = footOf(crew)
      const done = tally(crew.agents).get("done") ?? 0
      return {
        kind: "lost",
        words: footWords(foot),
        ...(foot.goOn && {
          then: `${short} can go on from here, with the ${done} done kept.`,
        }),
        goOn: foot.goOn,
      }
    }
  }
}

/** The Crews among `crews` the Pane opens for by itself (decision 22):
 * those at work it never opened for before, as `opened` remembers; once
 * opened, closed or not, never again. */
export function toOpen(
  crews: readonly Crew[],
  opened: ReadonlySet<string>
): Crew[] {
  return crews.filter(
    (crew) => crew.state === "working" && !opened.has(crew.id)
  )
}
