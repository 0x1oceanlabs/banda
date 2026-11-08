import { useEffect, useSyncExternalStore } from "react"
import { Refused, type Engine } from "@banda/contract"
import type { HarnessView } from "@banda/contract/harnesses"

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
  readers: Set<() => void>
}

const shared = new WeakMap<Engine, Shared>()

function of(engine: Engine): Shared {
  let one = shared.get(engine)
  if (!one) {
    one = { value: NONE, readAt: 0, reading: false, readers: new Set() }
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
  engine.call("harnesses.list", {}).then(
    (value) => {
      one.reading = false
      one.value = value
      one.readAt = Date.now()
      for (const reader of one.readers) reader()
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
