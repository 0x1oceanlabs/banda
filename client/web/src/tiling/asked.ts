/**
 * What an Agent on another machine opens shows here too (ADR 0120,
 * decision 6). Its `open_pane` says `pane.asked` in that machine's log;
 * the window follows it while it shows one of that machine's Threads, and
 * asks this machine's engine to place each Pane beside its Thread,
 * `workspaces.place_asked`. The engine checks it as an Agent's and places
 * it once, whichever window heard it.
 *
 * A window follows from the moment it shows such a Thread: what was
 * asked before places nothing, as a Thread not shown places nothing.
 */
import {
  type Engine,
  type Event,
  type ProjectId,
  type ProjectSummary,
  Refused,
} from "@banda/contract"
import type { PaneAsked, PlaceAsked } from "@banda/contract/workspaces"
import { useMachine } from "@banda/ui/hooks/use-status"
import { useEffect, useRef } from "react"
import type { Workspaces } from "./model"

/** The version of `pane.asked` this window reads. */
const VERSION = 1

/** How long before a machine that did not answer is asked again, in ms. */
const AGAIN = 2_000

/** How long a follow that broke off is taken up where it stopped, in ms:
 * a link that dropped for a moment, not a Thread put away and shown
 * again, whose Agent's asks meanwhile place nothing. */
const SOON = 30_000

/** What the window's own list of Pane kinds says of one. */
export type Kinds = {
  /** It leads a Group, as a Thread does: an Agent's Panes go into it. */
  leads: (kind: string) => boolean
  /** This build shows it for a Project of another machine. */
  elsewhere: (kind: string) => boolean
}

/** Whether the workspaces show a Pane that leads a Group, a Thread's, of
 * one of `theirs`. */
export function showsThreadOf(
  workspaces: Workspaces,
  theirs: ReadonlyMap<ProjectId, ProjectSummary>,
  kinds: Kinds
): boolean {
  return workspaces.list.some((workspace) =>
    workspace.columns.some((column) =>
      column.entries.some(
        (entry) => kinds.leads(entry.pane.kind) && theirs.has(entry.project)
      )
    )
  )
}

/**
 * What to ask this machine's engine for an event of `machine`'s log; none
 * for any other event or version, for one no Agent wrote, for a kind this
 * build does not show for another machine, and for a Project the machine
 * does not list: only a machine's own Project is placed from its log (ADR
 * 0106, law 2).
 */
export function placingOf(
  event: Event,
  machine: ProjectId,
  theirs: ReadonlyMap<ProjectId, ProjectSummary>,
  kinds: Kinds
): PlaceAsked | null {
  if (event.module !== "workspaces" || event.kind !== "pane.asked") return null
  if (event.version !== VERSION || event.author.kind !== "agent") return null
  const asked = event.payload as PaneAsked
  const project = theirs.get(asked.project)
  if (!project || !kinds.elsewhere(asked.kind)) return null
  return {
    from: machine,
    at: event.seq,
    by: event.author.id,
    thread: asked.thread,
    project: asked.project,
    kind: asked.kind,
    args: asked.args,
    // The window's word: this machine's engine knows no Project of
    // another's.
    scratch: project.scratch,
  }
}

/**
 * Follows `host`'s `pane.asked` while the window `shows` one of its
 * Threads, and has `own`, this machine's engine, place each for the
 * Projects that are `theirs`.
 */
export function useAsked(
  own: Engine,
  host: Engine,
  theirs: ReadonlyMap<ProjectId, ProjectSummary>,
  shows: boolean,
  kinds: Kinds
): void {
  const machine = useMachine(host)
  // Read as each event comes: a Project added there meanwhile is one of
  // theirs without following anew.
  const known = useRef(theirs)
  useEffect(() => {
    known.current = theirs
  }, [theirs])
  // Where the follow last stood in that machine's log, and when it broke
  // off.
  const stood = useRef<{ machine: ProjectId; at: number; left: number }>(null)

  useEffect(() => {
    if (!machine || !shows) return
    let stopped = false
    let unfollow = () => {}
    let retry: ReturnType<typeof setTimeout> | undefined
    // One that broke off a moment ago goes on from where it stood.
    const before = stood.current
    let last =
      before && before.machine === machine && Date.now() - before.left < SOON
        ? before.at
        : undefined
    const start = async (): Promise<void> => {
      if (last === undefined) {
        // Where its log stands now: nothing before it is asked for.
        try {
          last = (await host.call("workspaces.list", {})).at
        } catch (error) {
          // A refusal stands; a machine that did not answer is asked again.
          if (!stopped && !(error instanceof Refused))
            retry = setTimeout(() => void start(), AGAIN)
          return
        }
        if (stopped) return
      }
      unfollow = host.follow(
        machine,
        last,
        { module: "workspaces", kinds: ["pane.asked"] },
        (event) => {
          last = event.seq
          const asked = placingOf(event, machine, known.current, kinds)
          if (!asked) return
          own
            .command("workspaces.place_asked", asked)
            .catch((error: unknown) =>
              console.warn("a Pane asked for on another machine", error)
            )
        },
        // Ended with no refusal, it is followed again after the last one
        // heard: the engine here places none twice. With a refusal, that
        // log is not this window's to follow.
        (refusal) => {
          if (!stopped && !refusal) void start()
        }
      )
    }
    void start()
    return () => {
      stopped = true
      clearTimeout(retry)
      unfollow()
      stood.current =
        last === undefined ? null : { machine, at: last, left: Date.now() }
    }
  }, [own, host, machine, shows, kinds])
}
