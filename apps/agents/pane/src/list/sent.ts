/**
 * The Person's marks on a Thread, as this window sends them to the
 * Thread's host (ADR 0096): what they saw of it, unread and read, archived
 * and back, and that they saw it wake by itself (ADR 0074). The host keeps each one, beside the snooze, and every window
 * and machine reads it there, in the Thread's list. Only this file sends
 * them (architecture.test.ts), so none goes around what follows.
 *
 * - What was sent shows at once, over the list the host gave, until the
 *   list has heard what its command did: the Person never sees the mark
 *   flip back while its fact is on its way, whichever of the answer and
 *   the fact comes first (ADR 0082, decision 4).
 * - Nothing waits for a host away (decision 8): a mark made then is not
 *   sent, and one whose host went while it was on its way is taken back,
 *   and is not sent again once the host is back. A toast says so, as for
 *   one the host refused, but for the seen the window marks by itself,
 *   which fails quietly.
 * - A mark moves no Thread (decision 6): what shows changes the marks
 *   alone, never when the Thread changed or where it stands.
 * - No device's clock goes into a mark (decision 7): an archive shows
 *   from when the Thread last changed, the host's time, as the host's own
 *   holds from its own.
 *
 * Each host's marks are kept apart, by its engine, as a Thread's ID is its
 * host's alone. They are kept in memory only: after a reload, the host's
 * list says all.
 */
import {
  type Engine,
  Lost,
  type MethodOf,
  newId,
  type Params,
  type ProjectId,
} from "@banda/contract"
import type {
  ListedThread,
  ThreadId,
  ThreadList,
  TurnId,
  WokeSeen,
} from "@banda/contract/agents"
import { toast } from "@banda/ui/components/sonner"
import { Store, useStore } from "@banda/core/react"
import { problem } from "@banda/ui/lib/words"
import { useCallback } from "react"
import { archiveHolds, without } from "./list"

/**
 * A mark the Person gives a Thread, not Banda's Mark that shows what it
 * calls them for: the turn they saw end; `latest`, the latest that ended,
 * as "Mark as read" has it; none, as "Mark as unread" does; archived, or
 * brought back; or what they saw of it waking by itself.
 */
export type PersonMark =
  | { seen: TurnId | "latest" | null }
  | { archived: boolean }
  | { woke: WokeSeen }

/** A mark on its way: what it says, the command that carries it, and,
 * once the host answered, where in its log that command wrote. */
type Part<T> = { to: T; command: string; at?: number }

/** What is on its way of one Thread's marks. */
export type Sending = {
  seen?: Part<TurnId | "latest" | null>
  archived?: Part<boolean>
  woke?: Part<WokeSeen>
}

/** What is on its way of each Thread of one host, by its ID. */
export type Sendings = Readonly<Record<string, Sending>>

const NONE: Sendings = {}

/** Each host's, by its engine. */
const sent = new Store<ReadonlyMap<Engine, Sendings>>(new Map())

/** What is on its way to `engine` now. */
export function sendingTo(engine: Engine): Sendings {
  return sent.get().get(engine) ?? NONE
}

/** What is on its way to `engine`, drawn again only as that changes. */
export function useSending(engine: Engine): Sendings {
  return useStore(
    sent,
    useCallback((all) => all.get(engine) ?? NONE, [engine])
  )
}

/** Keeps `sendings` as what is on its way to `engine`. */
function keep(engine: Engine, sendings: Sendings): void {
  const all = new Map(sent.get())
  if (Object.keys(sendings).length > 0) all.set(engine, sendings)
  else all.delete(engine)
  sent.set(all)
}

type Which = keyof Sending

/** Changes `which` part of `thread`'s on its way to `engine` by `how`: a
 * part, or none to drop it. */
function change(
  engine: Engine,
  thread: string,
  which: Which,
  how: (part: Part<unknown> | undefined) => Part<unknown> | undefined
): void {
  const sendings = sendingTo(engine)
  const was = sendings[thread] ?? {}
  const part = how(was[which])
  if (part === was[which]) return
  const now: Sending = { ...was }
  if (part) Object.assign(now, { [which]: part })
  else delete now[which]
  const next = { ...sendings }
  if (now.seen || now.archived || now.woke) next[thread] = now
  else delete next[thread]
  keep(engine, next)
}

/**
 * Sends `mark` of `thread`, in `project`, to its host, `engine`: shown at
 * once, until the list hears what it did (`settle`). Whether the host took
 * it. A host away is sent nothing, and one that goes before it answers
 * takes the mark back here; either way, and when the host refuses it, a
 * toast says so, unless it is `quiet`, as the seen the window marks by
 * itself. Its command is sent `once` (`Engine.commandAt`): one whose
 * connection broke is not sent again once its host is back, so a mark
 * said to have failed does not land later. One that reached the host
 * before the break may have landed all the same: its fact then shows it,
 * as any mark made there.
 */
export async function mark(
  engine: Engine,
  project: ProjectId,
  thread: ThreadId,
  mark: PersonMark,
  { quiet = false }: { quiet?: boolean } = {}
): Promise<boolean> {
  const failed = (error: unknown) => {
    if (!quiet) toast.error(problem(error))
    return false
  }
  if (engine.status.state !== "open") return failed(new Lost())
  const [which, to]: [Which, unknown] =
    "seen" in mark
      ? ["seen", mark.seen]
      : "archived" in mark
        ? ["archived", mark.archived]
        : ["woke", mark.woke]
  const command = newId()
  change(engine, thread, which, () => ({ to, command }))
  // This mark's part, and no later one's, which took its place.
  const own = (part: Part<unknown> | undefined) => part?.command === command
  const answer = commandOf(engine, project, thread, mark, command)
  // Its own Lost, which comes after `gone` said its host went, has no
  // one to hear it.
  answer.catch(() => undefined)
  let stop = () => {}
  const gone = new Promise<never>((_, reject) => {
    stop = engine.watch((status) => {
      if (status.state !== "open") reject(new Lost())
    })
  })
  try {
    const { at } = await Promise.race([answer, gone])
    // What wrote nothing has nothing to wait for: the list holds it.
    change(engine, thread, which, (part) =>
      !own(part) ? part : at === null ? undefined : { ...part!, at }
    )
    return true
  } catch (error) {
    change(engine, thread, which, (part) => (own(part) ? undefined : part))
    return failed(error)
  } finally {
    stop()
  }
}

/** The command that carries `mark`. */
function commandOf(
  engine: Engine,
  project: ProjectId,
  thread: ThreadId,
  mark: PersonMark,
  command: string
): Promise<{ at: number | null }> {
  // Each goes once: none waits out a break to land after its toast
  // (decision 8).
  const send = <M extends MethodOf<"command">>(method: M, params: Params<M>) =>
    engine.commandAt(method, params, project, command, { once: true })
  if ("archived" in mark)
    return mark.archived
      ? send("agents.archive", { thread })
      : send("agents.unarchive", { thread })
  if ("woke" in mark)
    return send("agents.see_woke", { thread, seen: mark.woke })
  const { seen } = mark
  if (seen === null) return send("agents.unread", { thread })
  return send(
    "agents.read",
    seen === "latest" ? { thread } : { thread, turn: seen }
  )
}

/**
 * `threads` as the Person made them: each with what is on its way of its
 * marks over what its host listed. A seen shows only on the turn it names
 * while that is the Thread's latest, as a Pane may hear a turn end before
 * the list does; an archive shows from when the Thread last changed, so
 * it holds as the host's does. The same list where nothing shows, and the
 * same Thread where its marks show already. Pure.
 */
export function shown(
  threads: readonly ListedThread[],
  sendings: Sendings
): readonly ListedThread[] {
  let changed = false
  const marked = threads.map((thread) => {
    const sending = sendings[thread.id]
    const now = sending ? markedBy(thread, sending) : thread
    changed ||= now !== thread
    return now
  })
  return changed ? marked : threads
}

function markedBy(thread: ListedThread, sending: Sending): ListedThread {
  let now = thread
  const seen = sending.seen && seenOf(thread, sending.seen.to)
  if (seen === null) now = without(now, "seen")
  else if (seen !== undefined && now.seen !== seen) now = { ...now, seen }
  if (sending.archived?.to === false) now = without(now, "archived")
  else if (sending.archived && !archiveHolds(now))
    now = { ...now, archived: { at: now.updated_at } }
  // What it saw of its waking moves forward only, as its host keeps it.
  const woke = sending.woke?.to
  const { snooze } = now
  const was = snooze?.woke_seen
  if (woke && snooze && was !== "dismissed" && was !== woke)
    now = { ...now, snooze: { ...snooze, woke_seen: woke } }
  return now
}

/** The seen `to` gives `thread` as its list holds it: the turn it names,
 * while that is its latest; for `latest`, its latest once that ended;
 * `null` for none; undefined where it marks nothing there. */
function seenOf(
  thread: ListedThread,
  to: TurnId | "latest" | null
): TurnId | null | undefined {
  if (to === null) return null
  const { latest } = thread
  if (!latest) return undefined
  if (to === "latest")
    return latest.state === "running" ? undefined : latest.turn
  return latest.turn === to ? to : undefined
}

/**
 * Drops what `list`, of a Project of `engine`, has heard of what was sent
 * to it: each mark whose command wrote where the list stands, or before.
 * A `latest` takes the turn it marks as the list first shows it, so a
 * turn that begins and ends before its fact comes is not marked by it;
 * one the Thread works on already marks nothing here. Each list settles
 * its own Threads' marks, and changes nothing when it drops none.
 */
export function settle(engine: Engine, list: ThreadList): void {
  const sendings = sendingTo(engine)
  let next: Record<string, Sending> | undefined
  for (const thread of list.threads) {
    const sending = sendings[thread.id]
    if (!sending) continue
    const now = settled(thread, sending, list.at)
    if (now === sending) continue
    next ??= { ...sendings }
    if (now) next[thread.id] = now
    else delete next[thread.id]
  }
  if (next) keep(engine, next)
}

function settled(
  thread: ListedThread,
  sending: Sending,
  at: number
): Sending | undefined {
  const heard = <T>(part: Part<T> | undefined) =>
    part?.at !== undefined && part.at <= at ? undefined : part
  let seen = heard(sending.seen)
  const archived = heard(sending.archived)
  const woke = heard(sending.woke)
  if (seen?.to === "latest") {
    const latest = seenOf(thread, "latest")
    seen = latest ? { ...seen, to: latest } : undefined
  }
  if (
    seen === sending.seen &&
    archived === sending.archived &&
    woke === sending.woke
  )
    return sending
  if (!seen && !archived && !woke) return undefined
  return {
    ...(seen && { seen }),
    ...(archived && { archived }),
    ...(woke && { woke }),
  }
}
