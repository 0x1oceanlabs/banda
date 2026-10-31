import { useEffect, useState } from "react"
import {
  type Engine,
  type Event,
  type EventFilter,
  Refused,
  type Refusal,
  type SpaceId,
} from "@bandaso/contract"

/**
 * A view a Pane reads once and then keeps current from the Space's log.
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
 * Reads a view, then follows the Space's events after it (ADR 0002,
 * decision 5). The view stays current across reconnects; when the engine
 * asks for a fresh read, it reads again. Events that arrive within one
 * frame render once.
 */
export function useLive<S extends { at: number }>(
  engine: Engine,
  space: SpaceId,
  source: Source<S> | null
): Live<S> {
  // What is held belongs to one source; a new source starts as loading.
  const [held, setHeld] = useState<{ source: Source<S> | null; live: Live<S> }>(
    {
      source,
      live: LOADING,
    }
  )

  useEffect(() => {
    if (!source) return
    let stopped = false
    let unfollow = () => {}
    let frame = 0
    const hold = (live: Live<S>) => {
      if (!stopped) setHeld({ source, live })
    }

    const start = async (): Promise<void> => {
      if (stopped) return
      let view: S
      try {
        view = await source.read()
      } catch (error) {
        if (stopped) return
        if (error instanceof Refused)
          hold({ state: "refused", refusal: error.refusal })
        else setTimeout(() => void start(), AGAIN)
        return
      }
      if (stopped) return
      hold({ state: "ready", view })
      unfollow = engine.follow(
        space,
        view.at,
        source.filter,
        (event) => {
          const next = source.apply(view, event)
          if (next === READ_AGAIN) {
            unfollow()
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
          if (refusal) hold({ state: "refused", refusal })
          else if (!stopped) void start()
        }
      )
    }

    void start()
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      unfollow()
    }
  }, [engine, space, source])

  return held.source === source ? held.live : LOADING
}
