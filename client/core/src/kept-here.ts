/**
 * Here as one Window keeps it (ADR 0087, decision 4): always current as it
 * is read, and told to its readers once the Window drew a change. What it
 * is made from, the Tiling, the Window's areas and the device, is the
 * Window's to fold (`hereOf` in `client/web/src/window/here.tsx`).
 */
import type { Here, HereStore } from "./here"
import { sameData, Store } from "./store"

/** `now`, with each part that says what it said in `was` kept as it was,
 * and all of `was` when nothing changed: a reader that selects the Pane
 * is not drawn again as the Window comes to the front. */
export function keptHere(was: Here, now: Here): Here {
  if (sameData(was, now)) return was
  const old: Record<string, unknown> = was
  return Object.fromEntries(
    Object.entries(now).map(([key, part]) => [
      key,
      sameData(old[key], part) ? old[key] : part,
    ])
  ) as Here
}

/**
 * Here as one Window keeps it. `read` works it out from its sources as
 * they are now, so `get` is always current: a change the Tiling made and
 * React has not drawn yet is in it, and two keys in one slow frame each
 * act where the last left the Person. Each part stays the same object
 * while it says the same.
 *
 * Its readers are told by `tell`, once the Window has drawn a change of
 * it, never inside a tick of the clock. Every source of Here is the
 * Window's to draw (the Tiling's hook, the Sidebar, the Window in front),
 * so each change draws the Window, which tells; a source the Window
 * stops drawing for has to tell it itself. Told after the Window draws, a
 * reader draws in the commit after it: for a key, in the same task; for
 * what the engine says, maybe a frame later.
 */
export class KeptHere implements HereStore {
  readonly #read: () => Here
  #last: Here
  /** What the readers were told last. */
  readonly #told: Store<Here>

  constructor(read: () => Here) {
    this.#read = read
    this.#last = read()
    this.#told = new Store(this.#last)
  }

  readonly get = (): Here => {
    this.#last = keptHere(this.#last, this.#read())
    return this.#last
  }

  readonly subscribe = (listener: () => void): (() => void) =>
    this.#told.subscribe(listener)

  /** Tells each reader, once, that Here changed since they were told.
   * Back to what they were told, they hear nothing. */
  tell(): void {
    this.#last = keptHere(this.#told.get(), this.get())
    this.#told.set(this.#last)
  }
}
