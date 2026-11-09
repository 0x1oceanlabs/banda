/**
 * A store read by selector, from React (ADR 0088, decision 7): each
 * reader is drawn again only when what it selects changes, not each time
 * the value does, and never because a parent was drawn.
 */
import { useCallback, useState, useSyncExternalStore } from "react"
import type { Readable } from "../store"

/** What one reader drew last, which it keeps while `equal` finds what
 * `read` gives now the same: boxed, so one of `undefined` is told from
 * none. */
class Selection<S> {
  #last: { value: S } | null = null

  take(read: () => S, equal: (a: S, b: S) => boolean): S {
    const next = read()
    if (!this.#last || !equal(this.#last.value, next))
      this.#last = { value: next }
    return this.#last.value
  }
}

/**
 * What `read` gives, drawn again only when `subscribe` tells of a change
 * and `equal` finds the new selection different: `useSyncExternalStore`
 * with a selector. `read` may build a new object each time; the reader
 * keeps the one it drew while `equal` holds. Given the same `read` and
 * `equal` from one drawing to the next, React does not read again after
 * it draws. Drawn to text, as tests do, it reads the value now.
 */
export function useSelected<S>(
  subscribe: (listener: () => void) => () => void,
  read: () => S,
  equal: (a: S, b: S) => boolean = Object.is
): S {
  const [selection] = useState(() => new Selection<S>())
  const take = useCallback(
    () => selection.take(read, equal),
    [selection, read, equal]
  )
  return useSyncExternalStore(subscribe, take, take)
}

/** `select` of what `store` holds, drawn again only as that changes. A
 * `select` made once, not at each drawing, spares React a read. */
export function useStore<T, S>(
  store: Readable<T>,
  select: (value: T) => S,
  equal?: (a: S, b: S) => boolean
): S {
  const read = useCallback(() => select(store.get()), [store, select])
  return useSelected(store.subscribe, read, equal)
}
