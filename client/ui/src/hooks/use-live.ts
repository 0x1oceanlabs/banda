import { useEffect, useRef, useState } from "react"
import { useMachine } from "./use-status"
import {
  type Engine,
  type Event,
  type EventFilter,
  Refused,
  type Refusal,
  type ProjectId,
} from "@banda/contract"

/**
 * A view a Pane reads once and then keeps current from the Project's log.
 * Keep it in `useMemo`: a new source reads the view again.
 */
export type Source<S extends { at: number }> = {
  /** Reads the view; its `at` is where following starts. */
  read: () => Promise<S>
  filter: EventFilter
  /**
   * The view after one event. Return the same object when nothing changed,
   * and `READ_AGAIN` when only a fresh read can tell.
   */
  apply: (state: S, event: Event) => S | typeof READ_AGAIN
}

/** What `apply` returns when the view must be read again. */
export const READ_AGAIN = Symbol("read again")

export type Live<S> =
  | { state: "loading" }
  | { state: "ready"; view: S }
  | { state: "refused"; refusal: Refusal }

const LOADING = { state: "loading" } as const

/** How long to wait before reading again after the connection broke. */
const AGAIN = 500

/**
 * Reads a view, then follows the Project's events after it (ADR 0002,
 * decision 5). The view stays current across reconnects; when the engine
 * asks for a fresh read, it reads again. Events that arrive within one
 * frame render once. A new `round` reads again too, the view kept until
 * the read answers: for what no event tells, as files changed on disk.
 */
export function useLive<S extends { at: number }>(
  engine: Engine,
  project: ProjectId,
  source: Source<S> | null,
  round = 0
): Live<S> {
  // What is held belongs to one source; a new source starts as loading.
  const [held, setHeld] = useState<{ source: Source<S> | null; live: Live<S> }>(
    {
      source,
      live: LOADING,
    }
  )

  // How the running effect reads again, for a new round.
  const again = useRef(() => {})
  useEffect(() => {
    if (round > 0) again.current()
  }, [round])

  useEffect(() => {
    if (!source) return
    let stopped = false
    let unfollow = () => {}
    let frame = 0
    // Each read is numbered: only the newest one's answer is held, and
    // only it follows.
    let newest = 0
    const hold = (live: Live<S>) => {
      if (!stopped) setHeld({ source, live })
    }

    const start = async (): Promise<void> => {
      if (stopped) return
      const read = ++newest
      unfollow()
      unfollow = () => {}
      cancelAnimationFrame(frame)
      frame = 0
      const stale = () => stopped || read !== newest
      let view: S
      try {
        view = await source.read()
      } catch (error) {
        if (stale()) return
        if (error instanceof Refused)
          hold({ state: "refused", refusal: error.refusal })
        else setTimeout(() => void (stale() || start()), AGAIN)
        return
      }
      if (stale()) return
      hold({ state: "ready", view })
      unfollow = engine.follow(
        project,
        view.at,
        source.filter,
        (event) => {
          const next = source.apply(view, event)
          if (next === READ_AGAIN) {
            void start()
            return
          }
          if (next === view) return
          view = next
          frame ||= requestAnimationFrame(() => {
            frame = 0
            hold({ state: "ready", view })
          })
        },
        (refusal) => {
          if (stale()) return
          if (refusal) hold({ state: "refused", refusal })
          else void start()
        }
      )
    }

    again.current = () => void start()
    void start()
    return () => {
      again.current = () => {}
      stopped = true
      cancelAnimationFrame(frame)
      unfollow()
    }
  }, [engine, project, source])

  return held.source === source ? held.live : LOADING
}

/**
 * A view of the machine's own log, as `useLive` keeps a Project's: it reads
 * once the engine says which log is the machine's. Keep `source` in
 * `useMemo`.
 */
export function useMachineLive<S extends { at: number }>(
  engine: Engine,
  source: Source<S>,
  round = 0
): Live<S> {
  const machine = useMachine(engine)
  return useLive(engine, machine ?? "", machine ? source : null, round)
}
