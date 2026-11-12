/**
 * A Crew as its Thread words it (ADR 0103, decisions 18, 19, 26 and 30):
 * its card's strip of phases and dots, its foot's counts, how it ended,
 * the live line while it works after its turn, the line once it ended,
 * and the message that asks Claude to go on. The same for every client
 * (ADR 0089, decision 1); the views draw what this says. Pure, so plain
 * tests cover it.
 */
import type { Crew, CrewAgent, Phase } from "@banda/contract/agents"
import { SATELLITE_WORDS, type SatelliteState } from "@banda/ui/lib/satellite"
import { ago, duration } from "@banda/ui/lib/words"
import { firstLine } from "../entries/parts/messageText"
import type { Count } from "./subagents"

/** A phase with more agents than this is a bar of shares, so the strip
 * stays one line at 500 agents (decision 18). */
export const MOST_DOTS = 24

/** How a Crew's agent looks: its satellite's state. */
export function lookOfAgent(agent: CrewAgent): SatelliteState {
  return agent.state === "running" ? "working" : agent.state
}

/** One agent's dot: its look, and what its tooltip says. */
export type Dot = {
  key: string
  phase: number
  index: number
  look: SatelliteState
  /** "hosts/pair.ts · Failed". */
  tip: string
}

/** How many of a phase's agents look one way, in a bar's order. */
export type Share = { look: SatelliteState; n: number }

/** One phase of the strip. */
export type StripPhase = {
  index: number
  title: string
  /** Before the one at work, the one at work, or not reached yet. */
  when: "past" | "current" | "future"
  /** Every agent of it is done: a ✓ before its name. */
  done: boolean
  /** "4/7": its agents done of those called so far, on the current phase
   * and on a bar. */
  count?: string
  /** Its agents, each a dot, up to {@link MOST_DOTS}. */
  dots: Dot[]
  /** More than that: the shares of a thin bar, done first, the waiting
   * ones last. */
  bar?: Share[]
  /** What a bar's tooltip says: "Fix · 150 agents · 10 working · …". */
  tip: string
}

/** The order a bar's shares go in, left to right; the waiting ones are
 * its empty rest. */
const BAR: SatelliteState[] = [
  "done",
  "failed",
  "stopped",
  "lost",
  "asks",
  "working",
  "queued",
]

/** The phase a Crew at work is in: that of the agent that started last,
 * as the engine's brief says it, else its first. None once it ended. */
export function currentPhase(crew: Crew): number | undefined {
  if (crew.state !== "working" && crew.state !== "lost") return undefined
  let latest: CrewAgent | undefined
  for (const agent of crew.agents) {
    if (agent.started === undefined) continue
    if (
      !latest ||
      agent.started > (latest.started ?? 0) ||
      (agent.started === latest.started &&
        (agent.phase > latest.phase ||
          (agent.phase === latest.phase && agent.index > latest.index)))
    )
      latest = agent
  }
  return (latest ?? crew.agents.at(-1))?.phase ?? crew.phases[0]?.index
}

/** The agents of phase `index`, in their order there. */
function agentsOf(crew: Crew, index: number): CrewAgent[] {
  return crew.agents.filter((agent) => agent.phase === index)
}

/** How many of `agents` look each way. */
export function tally(
  agents: readonly CrewAgent[]
): Map<SatelliteState, number> {
  const counts = new Map<SatelliteState, number>()
  for (const agent of agents) {
    const look = lookOfAgent(agent)
    counts.set(look, (counts.get(look) ?? 0) + 1)
  }
  return counts
}

/** The strip of `crew`: each phase's name and its agents (decision 18). */
export function stripOf(crew: Crew): StripPhase[] {
  const current = currentPhase(crew)
  return crew.phases.map((phase) => {
    const agents = agentsOf(crew, phase.index)
    const when =
      current === undefined
        ? agents.length > 0
          ? "past"
          : "future"
        : phase.index < current
          ? "past"
          : phase.index === current
            ? "current"
            : "future"
    const done = agents.filter((agent) => agent.state === "done").length
    const big = agents.length > MOST_DOTS
    const counts = tally(agents)
    return {
      index: phase.index,
      title: phase.title,
      when,
      done: agents.length > 0 && done === agents.length,
      ...((when === "current" || big) && {
        count: `${done}/${agents.length}`,
      }),
      dots: big
        ? []
        : agents.map((agent) => ({
            key: `${agent.phase}.${agent.index}`,
            phase: agent.phase,
            index: agent.index,
            look: lookOfAgent(agent),
            tip: dotTip(agent),
          })),
      ...(big && {
        bar: BAR.flatMap((look) => {
          const n = counts.get(look) ?? 0
          return n > 0 ? [{ look, n }] : []
        }),
      }),
      tip: [
        phase.title,
        `${agents.length} agent${agents.length === 1 ? "" : "s"}`,
        ...countWords(counts).map((count) => count.words),
      ].join(" · "),
    }
  })
}

/** What a dot's tooltip says: its agent and its state. */
export function dotTip(agent: CrewAgent): string {
  const label = agent.label.trim() || `Agent ${agent.index}`
  return `${label} · ${SATELLITE_WORDS[lookOfAgent(agent)]}`
}

/** The counts at work, each that is not none: "3 working", "1 asks", "2
 * done", "1 failed", "20 waiting". */
export function countWords(counts: Map<SatelliteState, number>): Count[] {
  const of = (look: SatelliteState) => counts.get(look) ?? 0
  const all: Count[] = [
    { words: `${of("working")} working` },
    { words: `${of("asks")} asks`, tone: "asks" },
    { words: `${of("done")} done` },
    { words: `${of("failed")} failed`, tone: "failed" },
    { words: `${of("queued")} waiting` },
  ]
  return all.filter((count) => !count.words.startsWith("0 "))
}

/** A Crew's foot: its counts, its time that does not tick, and whether it
 * offers Ask Claude to go on (decisions 18, 20 and 26). */
export type Foot = { counts: Count[]; time?: string; goOn: boolean }

export const plural = (n: number, noun: string) =>
  `${n} ${noun}${n === 1 ? "" : "s"}`

/** `crew`'s foot at `now`: at work, "12 agents · 6 working · 4 done · 2
 * failed"; done, "12 agents · 3 phases · 2 failed"; Lost, why it stopped
 * and how many were done. */
export function footOf(crew: Crew, now = Date.now()): Foot {
  const counts = tally(crew.agents)
  const agents = { words: plural(crew.agents.length, "agent") }
  const failed = counts.get("failed") ?? 0
  const time =
    crew.ended !== undefined
      ? duration(crew.ended - crew.started)
      : ago(crew.started, now)
  switch (crew.state) {
    case "working":
      return { counts: [agents, ...countWords(counts)], time, goOn: false }
    case "done":
      return {
        counts: [
          agents,
          { words: plural(crew.phases.length, "phase") },
          ...(failed > 0
            ? [{ words: `${failed} failed`, tone: "failed" as const }]
            : []),
        ],
        time,
        goOn: false,
      }
    case "failed":
      return {
        counts: [
          agents,
          { words: "Failed", tone: "failed" },
          ...(failed > 0
            ? [{ words: `${plural(failed, "agent")} failed` }]
            : []),
        ],
        time,
        goOn: false,
      }
    case "stopped":
    case "lost": {
      const why =
        firstLine(crew.why)?.replace(/\.$/, "") ||
        (crew.state === "lost" ? "Lost" : "Stopped")
      const done = counts.get("done") ?? 0
      return {
        counts: [
          { words: why },
          { words: `${done} of ${crew.agents.length} done` },
        ],
        goOn: crew.state === "lost",
      }
    }
  }
}

/** The foot as one line of words, as a screen reader or a test reads it. */
export function footWords({ counts, time }: Foot): string {
  return [...counts.map((count) => count.words), ...(time ? [time] : [])].join(
    " · "
  )
}

/** The quiet line under the strip: what its script last logged, or why
 * it failed. None when neither is said (amended 2026-11-12: the log line
 * comes with its end). */
export function quietOf(crew: Crew): string | undefined {
  if (crew.state === "failed") return firstLine(crew.why) || crew.log
  return crew.log?.trim() || undefined
}

/** Where a Crew stands as the live line and list say it: "Fix 4/7", its
 * current phase's agents done of those called so far. None before any
 * phase. */
export function phaseWords(crew: Crew): string | undefined {
  const at = currentPhase(crew)
  const phase = crew.phases.find((one) => one.index === at)
  if (at === undefined || !phase) return undefined
  const agents = agentsOf(crew, at)
  const done = agents.filter((agent) => agent.state === "done").length
  return `${phase.title} ${done}/${agents.length}`
}

/** What names the Crew whose agent asks, in the dock: "Crew
 * audit-routes" (decision 28); none when no Crew of `crews` asks. */
export function crewAsker(
  crew: string | undefined,
  crews: readonly Crew[]
): string | undefined {
  const asks = crews.find((one) => one.id === crew)
  return asks && `Crew ${asks.title}`
}

/** The Crews among `crews` at work. */
export function working(crews: readonly Crew[]): Crew[] {
  return crews.filter((crew) => crew.state === "working")
}

/** What a running turn's live line says of its Crew at work, after its
 * clock: "Crew audit-routes · Scan 0/2" (decision 19). The latest that
 * works, of those `turn` started. */
export function duringCrew(
  crews: readonly Crew[],
  turn: string
): string | undefined {
  const crew = working(crews)
    .filter((one) => one.turn === turn)
    .at(-1)
  if (!crew) return undefined
  return [`Crew ${crew.title}`, phaseWords(crew)].filter(Boolean).join(" · ")
}

/** What the live line says once no turn runs and a Crew works on:
 * "Crew audit-routes is at work · Fix 4/7", then, muted, "Claude goes on
 * when it ends" (decision 19). Two at once count: "2 Crews at work". */
export function afterCrew(
  crews: readonly Crew[],
  short: string
): { words: string; then: string } | undefined {
  const live = working(crews)
  if (live.length === 0) return undefined
  if (live.length > 1)
    return {
      words: `${live.length} Crews at work`,
      then: `${short} goes on when they end`,
    }
  const [crew] = live
  const at = phaseWords(crew)
  return {
    words: `Crew ${crew.title} is at work${at ? ` · ${at}` : ""}`,
    then: `${short} goes on when it ends`,
  }
}

/** How a Crew ended, in a word after its name. */
const HOW: Record<Crew["state"], string> = {
  working: "works",
  done: "finished",
  failed: "failed",
  stopped: "stopped",
  lost: "stopped",
}

/** The words of a Crew's end, after its turn: "Crew audit-routes
 * finished · 14m", then, once Claude went on with it, "Claude went on by
 * itself" (decision 19). */
export function endedWords(
  crew: Crew,
  short: string
): { words: string; then?: string } {
  const how = HOW[crew.state]
  const took =
    crew.ended === undefined ? "" : ` · ${duration(crew.ended - crew.started)}`
  return {
    words: `Crew ${crew.title} ${how}${took}`,
    ...(crew.went_on !== undefined && {
      then: `${short} went on by itself`,
    }),
  }
}

/** What a notification says of a Crew that ended: "Crew audit-routes
 * finished · 2 failed" (decision 33). */
export function endedNote(
  title: string,
  state: Crew["state"],
  failed: number
): string {
  return `Crew ${title} ${HOW[state]}${failed > 0 ? ` · ${failed} failed` : ""}`
}

/** The message Ask Claude to go on puts in the composer (decision 26):
 * ready to send, or to change first. */
export function goOnMessage(crew: Crew): string {
  const done = crew.agents.filter((agent) => agent.state === "done").length
  return (
    `The Crew ${crew.title} stopped before it ended, with ${done} of its ` +
    `${plural(crew.agents.length, "agent")} done. Please go on from where ` +
    "it stopped, and keep what the last run did."
  )
}

/** The Question to start a Crew, as its script's `meta` says it (decision
 * 30): its phases in words, "1 Scan · 2 Fix · 3 Verify". */
export function phasesLine(phases: readonly Phase[]): string {
  return phases.map((phase) => `${phase.index} ${phase.title}`).join(" · ")
}

/** What the Question to start a Crew notes under its phases. */
export const START_NOTE =
  "Up to 16 sub-agents at once · uses your limits faster"

/** What the Question to start a Crew heads with. */
export function startHead(name: string): string {
  return `${name} wants to start a Crew`
}
