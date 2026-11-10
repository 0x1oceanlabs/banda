import { useEffect, useMemo, useSyncExternalStore } from "react"
import { Refused, type Engine } from "@banda/contract"
import type { Accounted, HarnessView } from "@banda/contract/harnesses"
import { type Live, READ_AGAIN, type Source, useMachineLive } from "./use-live"

const NONE: HarnessView[] = []
/** How long to wait before reading again after the connection broke. */
const AGAIN = 500
/** How old a list a reader that mounts takes without reading again: rows
 * that mount one by one, as a sidebar's do, read it once. */
const FRESH = 2000

/** One engine's list, read once for every reader mounted together. */
type Shared = {
  value: HarnessView[]
  /** When it was read, by `Date.now()`; 0 before. */
  readAt: number
  reading: boolean
  revision: number
  readers: Set<() => void>
}

const shared = new WeakMap<Engine, Shared>()

function of(engine: Engine): Shared {
  let one = shared.get(engine)
  if (!one) {
    one = {
      value: NONE,
      readAt: 0,
      reading: false,
      revision: 0,
      readers: new Set(),
    }
    shared.set(engine, one)
  }
  return one
}

/** Reads the list again, unless a read is on its way: what it reads,
 * every reader sees. A refusal leaves the list as it was; a broken
 * connection reads again while someone reads. */
function read(engine: Engine, one: Shared) {
  if (one.reading || Date.now() - one.readAt < FRESH) return
  one.reading = true
  const revision = one.revision
  engine.call("harnesses.list", {}).then(
    (value) => {
      one.reading = false
      if (revision === one.revision) takeHarnesses(engine, value)
    },
    (error: unknown) => {
      one.reading = false
      if (error instanceof Refused) return
      setTimeout(() => one.readers.size > 0 && read(engine, one), AGAIN)
    }
  )
}

/** The Harnesses this machine can run, in the order its list names them
 * (the machine's module `harnesses`, ADR 0040); none yet while they
 * load. A reader that mounts reads the list again, unless it was read a
 * moment ago: the readers mounted together share one read. */
export function useHarnesses(engine: Engine): HarnessView[] {
  const one = of(engine)
  const value = useSyncExternalStore(
    (changed) => {
      one.readers.add(changed)
      return () => one.readers.delete(changed)
    },
    () => one.value
  )
  useEffect(() => read(engine, one), [engine, one])
  return value
}

/** A list Settings has just read after a change. Mounted pickers receive
 * it too; a read already in flight cannot put the old list back. */
export function takeHarnesses(engine: Engine, value: HarnessView[]): void {
  const one = of(engine)
  one.revision++
  one.value = value
  one.readAt = Date.now()
  for (const reader of one.readers) reader()
}

/**
 * Who is signed in to `harness`, which asks it, so starts it if need be.
 * It is read again as the machine says its account changed, a sign-in or
 * sign-out anywhere, and at each new `round`, a Person's "check again".
 */
export function useAccount(
  engine: Engine,
  harness: string | undefined,
  round = 0
): Live<Accounted> {
  const source = useMemo<Source<Accounted> | null>(
    () =>
      harness === undefined
        ? null
        : {
            read: () => engine.call("harnesses.account", { harness }),
            filter: {
              module: "harnesses",
              subject: harness,
              kinds: ["account_changed"],
            },
            apply: () => READ_AGAIN,
          },
    [engine, harness]
  )
  return useMachineLive(engine, source, round)
}
