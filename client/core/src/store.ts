/**
 * A value kept outside React, read by selector (ADR 0088, decision 7):
 * each reader is drawn again only when what it selects changes, not each
 * time the value does, and never because a parent was drawn. The Window
 * keeps what the Apps list and what calls so (ADR 0087, decision 5). The
 * hooks that read one are `@banda/core/react`'s (`react/store.ts`), so
 * what holds no React, as Electron main, takes none in with it.
 */

/** A value kept outside React, as its readers see it: what it is now, and
 * who hears it change. Only its owner sets it. */
export type Readable<T> = {
  readonly get: () => T
  /** Calls `listener` on each change; returns how to stop. */
  readonly subscribe: (listener: () => void) => () => void
}

export class Store<T> implements Readable<T> {
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

/** Whether two values of plain data, as a Listed or Here is, say the
 * same. */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  const one = a as Record<string, unknown>
  const other = b as Record<string, unknown>
  return keys.every(
    (key) => Object.hasOwn(other, key) && sameData(one[key], other[key])
  )
}
