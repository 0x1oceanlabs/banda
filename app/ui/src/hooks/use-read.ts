import { useEffect, useState } from "react"
import { Refused, type Refusal } from "@banda/contract"

export type Read<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "refused"; refusal: Refusal }

const LOADING = { state: "loading" } as const
/** How long to wait before reading again after the connection broke. */
const AGAIN = 500

/**
 * Reads something once: a list to pick from, say. A refusal is kept to
 * show; a broken connection reads again. Keep `read` in `useMemo` or
 * `useCallback`: a new one reads again; `null` reads nothing.
 */
export function useRead<T>(read: (() => Promise<T>) | null): Read<T> {
  const [held, setHeld] = useState<{ read: typeof read; result: Read<T> }>({
    read,
    result: LOADING,
  })
  useEffect(() => {
    if (!read) return
    let stopped = false
    const start = () => {
      read().then(
        (value) =>
          !stopped && setHeld({ read, result: { state: "ready", value } }),
        (error: unknown) => {
          if (stopped) return
          if (error instanceof Refused) {
            setHeld({
              read,
              result: { state: "refused", refusal: error.refusal },
            })
          } else {
            setTimeout(() => !stopped && start(), AGAIN)
          }
        }
      )
    }
    start()
    return () => {
      stopped = true
    }
  }, [read])
  return held.read === read ? held.result : LOADING
}
