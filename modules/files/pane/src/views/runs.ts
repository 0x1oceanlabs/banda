/**
 * Runs of a file that a long view reads as they come into view: a hex
 * view's pages of bytes, a table's runs of rows. Each run is read once;
 * past the most kept, those read longest ago are forgotten, but those
 * that stay. All are forgotten as what they are of changes, as for
 * another file.
 */
import { useCallback, useState } from "react"

export function useRuns<T>(of: unknown, kept: number) {
  const [held, setHeld] = useState(() => ({
    of,
    runs: new Map<number, T>(),
    asked: new Set<number>(),
  }))
  if (held.of !== of) setHeld({ of, runs: new Map(), asked: new Set() })
  const [, drawn] = useState(0)

  /** Reads run `run` by `read`, unless it is read or being read; `stays`
   * names the runs never forgotten. */
  const want = useCallback(
    (run: number, read: () => Promise<T>, stays?: (run: number) => boolean) => {
      if (held.runs.has(run) || held.asked.has(run)) return
      held.asked.add(run)
      read().then(
        (value) => {
          held.asked.delete(run)
          held.runs.set(run, value)
          for (const old of held.runs.keys()) {
            if (held.runs.size <= kept) break
            if (!stays?.(old)) held.runs.delete(old)
          }
          drawn((n) => n + 1)
        },
        () => held.asked.delete(run)
      )
    },
    [held, kept]
  )
  return {
    /** Run `run`, once it is read. */
    get: (run: number): T | undefined => held.runs.get(run),
    want,
    /** Whether the runs are of `of`, not of what came before. */
    current: held.of === of,
  }
}
