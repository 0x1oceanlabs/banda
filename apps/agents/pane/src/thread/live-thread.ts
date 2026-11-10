/** A Thread as a Pane follows it: loaded once, then each of its events. */
import { useMemo } from "react"
import type { Engine, Event, ProjectId } from "@banda/contract"
import {
  decodeFact,
  type Fact,
  type Item,
  knownItem,
  type SubagentId,
  type ThreadId,
  type WhySupervised,
} from "@banda/contract/agents"
import { useLive } from "@banda/ui/hooks/use-live"
import { changedBy, ends, namedBy, startedBy, subOf } from "./facts"
import { apply, fromView, type ThreadState } from "./state"

/** Why Banda kept a Thread Supervised, and when, in ms since the epoch. */
export type Supervised = WhySupervised & { at: number }

/**
 * A Thread as its Pane follows it: the engine's view of it, which the
 * Pane's projection keeps equal (ADR 0014, decision 3), and what the Pane
 * heard as it followed that no view holds.
 */
export type Followed = ThreadState & {
  /** Why Banda last kept it Supervised while this Pane followed it, and
   * when (ADR 0083): the fence no longer keeps its Full access. A view
   * read again forgets it; the Pane keeps what it said of it. */
  supervised?: Supervised
  /** What each sub-agent at work last did, its latest entry, as this
   * Pane heard it: what its row says it does now (ADR 0103, decision 15).
   * A view read again forgets it, until each does its next thing. */
  heard?: ReadonlyMap<SubagentId, Item>
}

/** `apply`, what Banda said as it kept the Thread Supervised, and what
 * each sub-agent last did. Pure, so plain tests cover it. */
export function follow(state: Followed, event: Event): Followed {
  const next: Followed = apply(state, event)
  if (next === state) return next
  const fact = decodeFact(event)
  if (!fact) return next
  const heard = hear(next.heard, fact, event, next)
  const followed = heard === next.heard ? next : { ...next, heard }
  return fact.kind === "thread.configured" && fact.payload.supervised
    ? {
        ...followed,
        supervised: { ...fact.payload.supervised, at: event.at },
      }
    : followed
}

/**
 * What the Pane heard of each sub-agent, after `fact`: the entry a fact of
 * its lane starts is its latest, and a change by ID reaches it; one that
 * ended is forgotten, as are those a rewind took. Its Question is not its
 * work: the Thread keeps it, and its row reads it there. The same map when
 * nothing changed.
 */
function hear(
  heard: ReadonlyMap<SubagentId, Item> | undefined,
  fact: Fact,
  event: Event,
  state: ThreadState
): ReadonlyMap<SubagentId, Item> | undefined {
  const sub = subOf(fact)
  if (sub !== undefined && fact.kind !== "question.asked") {
    const was = heard?.get(sub)
    const latest =
      was !== undefined && was.id === namedBy(fact)
        ? changedBy(was, fact)
        : startedBy(fact, event)
    if (latest === undefined || latest === was) return heard
    return new Map(heard).set(sub, latest)
  }
  if (!heard?.size) return heard
  const id = namedBy(fact)
  if (id !== undefined) {
    for (const [lane, item] of heard)
      if (item.id === id) {
        const latest = changedBy(item, fact)
        return latest === item ? heard : new Map(heard).set(lane, latest)
      }
    return heard
  }
  const forget = (gone: (lane: SubagentId) => boolean) => {
    const kept = new Map([...heard].filter(([lane]) => !gone(lane)))
    return kept.size === heard.size ? heard : kept
  }
  switch (fact.kind) {
    case "subagent.ended":
      return forget((lane) => lane === fact.payload.subagent)
    case "subagent.changed":
      return fact.payload.state !== undefined && ends(fact.payload.state)
        ? forget((lane) => lane === fact.payload.subagent)
        : heard
    case "thread.rewound": {
      const kept = new Set(state.subagents.map((lane) => lane.id))
      return forget((lane) => !kept.has(lane))
    }
    default:
      return heard
  }
}

/**
 * The Thread `thread` of `project` as its engine has it now. Its entries of
 * a kind this window does not know are left out, and named once in
 * `window.log` (ADR 0103, decision 10): a newer engine wrote them.
 */
export async function readThread(
  engine: Engine,
  project: ProjectId,
  thread: ThreadId
): Promise<Followed> {
  const view = await engine.call("agents.thread", { thread }, { project })
  const unknown = new Set(
    view.items.filter((item) => !knownItem(item)).map((item) => item.body.kind)
  )
  if (unknown.size > 0)
    console.warn(
      `agents: left out entries of kinds this window does not know: ${[...unknown].join(", ")}`
    )
  return fromView(view)
}

/** The Thread `thread` of `project`, live; none to follow without one. */
export function useThread(
  engine: Engine,
  project: ProjectId,
  thread: ThreadId | null
) {
  const source = useMemo(
    () =>
      thread === null
        ? null
        : {
            read: () => readThread(engine, project, thread),
            filter: { module: "agents", subject: thread },
            apply: follow,
          },
    [engine, project, thread]
  )
  return useLive(engine, project, source)
}
