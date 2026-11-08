/**
 * An object that stays the same for those that hold it, and does what the
 * latest one does as they use it: the Window's action context (ADR 0088,
 * decision 7). What holds it, the keys' listener, the Tiles' frame and
 * the widgets, never has to be made again as it changes. `steady` is
 * pure, so plain tests cover it.
 */
import { useInsertionEffect, useState } from "react"

/** A box whose `current` the holder keeps the latest in. */
export type Latest<T> = { readonly current: T }

/**
 * The steady face of `latest`, made as `first` is: each function `first`
 * has is one function for good, which calls the function `latest.current`
 * has as it is called; each other value is read from `latest.current` as
 * it is asked.
 */
export function steady<T extends object>(first: T, latest: Latest<T>): T {
  const face = {}
  for (const [key, value] of Object.entries(first)) {
    const now = () => (latest.current as Record<string, unknown>)[key]
    const call =
      typeof value === "function"
        ? (...args: unknown[]) =>
            (now() as (...args: unknown[]) => unknown)(...args)
        : undefined
    Object.defineProperty(face, key, {
      enumerable: true,
      get: () => call ?? now(),
    })
  }
  return face as T
}

/** The latest of what a component made, and its steady face. */
class Held<T extends object> {
  current: T
  readonly face: T

  constructor(first: T) {
    this.current = first
    this.face = steady(first, this)
  }

  take(latest: T): void {
    this.current = latest
  }
}

/** `fresh`, made afresh with each drawing, held steady: one object for
 * the component's life that does what the latest drawing's does. It
 * takes the latest as React commits it, before any part's layout effect
 * runs, so none of them calls what an older drawing made. */
export function useSteady<T extends object>(fresh: T): T {
  const [held] = useState(() => new Held(fresh))
  useInsertionEffect(() => held.take(fresh))
  return held.face
}
