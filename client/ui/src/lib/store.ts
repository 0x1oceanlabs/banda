/**
 * A value kept outside React, read by selector (ADR 0088, decision 7):
 * each reader is drawn again only when what it selects changes, not each
 * time the value does, and never because a parent was drawn. The Window
 * keeps what the Apps list and what calls so (ADR 0087, decision 5).
 */
import { useCallback, useState, useSyncExternalStore } from "react"

export class Store<T> {
  #value: T
  readonly #heard = new Set<() => void>()

  constructor(first: T) {
    this.#value = first
  }

  /** The value now. */
  readonly get = (): T => this.#value

  /** Keeps `value` and tells each listener, unless it is the one kept. */
  set(value: T): void {
    if (Object.is(value, this.#value)) return
    this.#value = value
    for (const hear of [...this.#heard]) hear()
  }

  /** Calls `listener` on each new value; returns how to stop. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#heard.add(listener)
    return () => {
      this.#heard.delete(listener)
    }
  }
}

/** Whether two lists hold the same things, each the same object. */
export function sameEach<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((one, i) => Object.is(one, b[i]))
}

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
  store: Store<T>,
  select: (value: T) => S,
  equal?: (a: S, b: S) => boolean
): S {
  const read = useCallback(() => select(store.get()), [store, select])
  return useSelected(store.subscribe, read, equal)
}
