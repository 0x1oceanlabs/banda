/**
 * A Space's `git.watch`, shared by every card and Diff that shows it:
 * one stream, one fetch every 30 seconds, however many are open.
 */
import { useCallback, useSyncExternalStore } from "react"
import type { Engine, SpaceId } from "@banda/contract"
import type { Status } from "@banda/contract/git"

type Watched = {
  status: Status | null
  hearing: Set<() => void>
  /** How to stop the stream; none while it is not heard. */
  stop?: () => void
  leaving?: ReturnType<typeof setTimeout>
}

const watched = new WeakMap<Engine, Map<SpaceId, Watched>>()

/** How long a Space's watch stays after its last hearer went: a popover
 * opened again has the status at once, and fetches no more. */
const LINGER = 60_000
/** How long after the engine ended a watch it is asked again. */
const AGAIN = 1000

function watching(engine: Engine, space: SpaceId): Watched {
  let spaces = watched.get(engine)
  if (!spaces) watched.set(engine, (spaces = new Map()))
  let watch = spaces.get(space)
  if (!watch) spaces.set(space, (watch = { status: null, hearing: new Set() }))
  return watch
}

function tell(watch: Watched, status: Status | null): void {
  watch.status = status
  for (const hear of watch.hearing) hear()
}

function start(engine: Engine, space: SpaceId, watch: Watched): void {
  watch.stop = engine.stream(
    space,
    "git.watch",
    {},
    (status) => tell(watch, status),
    (refusal) => {
      watch.stop = undefined
      tell(watch, null)
      // Ended unasked, it is asked again while some still hear it;
      // refused, by the next to come.
      if (refusal) return
      setTimeout(() => {
        if (!watch.stop && watch.hearing.size > 0) start(engine, space, watch)
      }, AGAIN)
    }
  )
}

/** Hears each change of the Space's status, starting its watch; returns
 * how to stop. The watch lingers a while after the last hearer went. */
export function hearStatus(
  engine: Engine,
  space: SpaceId,
  hear: () => void
): () => void {
  const watch = watching(engine, space)
  clearTimeout(watch.leaving)
  watch.hearing.add(hear)
  if (!watch.stop) start(engine, space, watch)
  return () => {
    watch.hearing.delete(hear)
    if (watch.hearing.size > 0) return
    watch.leaving = setTimeout(() => {
      watch.stop?.()
      watch.stop = undefined
      // Only this watch: a newer one of the Space stays.
      const spaces = watched.get(engine)
      if (spaces?.get(space) === watch) spaces.delete(space)
    }, LINGER)
  }
}

/** The Space's status as its watch last said it. */
export function statusOf(engine: Engine, space: SpaceId): Status | null {
  return watched.get(engine)?.get(space)?.status ?? null
}

/** The Space's status as `git.watch` says it; none until it first does,
 * when the engine refuses it, or while it is not `heard`, when nothing
 * watches it for this. */
export function useGitStatus(
  engine: Engine,
  space: SpaceId,
  heard = true
): Status | null {
  const subscribe = useCallback(
    (hear: () => void) => (heard ? hearStatus(engine, space, hear) : () => {}),
    [engine, space, heard]
  )
  return useSyncExternalStore(subscribe, () =>
    heard ? statusOf(engine, space) : null
  )
}
