/**
 * What this device keeps of what a machine last said, "as of" a time
 * (ADR 0106, law 4; #1243): a read's answer, by the machine it came from
 * and the shelf it is of, kept in the device's storage, so a window that
 * starts draws it at once, marked as of then, before that machine is
 * heard again, or while it is away.
 *
 * It is a cache and no more. What a machine says now wins over it, an
 * act never waits on it and never answers from it, and nothing kept here
 * is authority: every act is still the engine's to allow. It holds no
 * secret, no pass, no key and no terminal's screen, which shows what was
 * typed: a shelf is a list or a view the Window draws anyway. A machine
 * the device lets go of is wiped (`wipe`).
 *
 * A shelf names its shape's version (`rows@1`): a reader of another
 * version finds nothing, and what it kept in an older one is dropped as
 * the machine is wiped or written again. What does not read as the shelf
 * says (`is`) is none.
 */
import type { DeviceStorage } from "./queue"

/** What a machine last said, and when this device heard it, in ms since
 * the epoch. */
export type Kept<T> = { value: T; at: number }

/** One kind of thing the cache keeps of a machine: its name with its
 * shape's version, as `rows@1`, and whether a stored value is one. */
export type Shelf<T> = {
  name: string
  is: (value: unknown) => value is T
}

const DAY = 24 * 60 * 60_000

/** How long a thing is kept: after 30 days it says too little of its
 * machine to draw. */
export const KEEP_FOR = 30 * DAY

/** The most one thing may take in the storage, in characters: the
 * storage is small, and the drafts and what waits are in it too. */
export const LIMIT = 512 * 1024

/** Where the device's storage keeps it. */
const PREFIX = "banda.asof."

const keyOf = (machine: string, shelf?: string) =>
  `${PREFIX}${encodeURIComponent(machine)}/${shelf ?? ""}`

/** The cache on a device's storage, as the window's `localStorage` is.
 * A storage that fails keeps nothing, and reads as empty: the Window
 * then starts as it did before it had one. */
export class Cache {
  readonly #storage: () => DeviceStorage
  readonly #now: () => number

  constructor(storage: () => DeviceStorage, now: () => number = Date.now) {
    this.#storage = storage
    this.#now = now
  }

  /** What `machine` last said of `shelf`, and when; none where it kept
   * none, one past its time, which it forgets then, or one that is not
   * what the shelf says. */
  read<T>(machine: string, shelf: Shelf<T>): Kept<T> | undefined {
    try {
      const text = this.#storage().getItem(keyOf(machine, shelf.name))
      if (text === null) return undefined
      const { at, value } = JSON.parse(text) as {
        at?: unknown
        value?: unknown
      }
      if (typeof at !== "number" || !shelf.is(value)) return undefined
      if (this.#now() - at > KEEP_FOR) {
        this.#storage().removeItem(keyOf(machine, shelf.name))
        return undefined
      }
      return { at, value }
    } catch {
      return undefined
    }
  }

  /** Keeps `value` as what `machine` said of `shelf` at `at`. One over
   * the limit, or one the storage does not take, is not kept, and what
   * was kept before it goes: it is no longer what the machine says.
   * Says whether it is kept. */
  write<T>(
    machine: string,
    shelf: Shelf<T>,
    value: T,
    at: number = this.#now()
  ): boolean {
    const key = keyOf(machine, shelf.name)
    try {
      const text = JSON.stringify({ at, value })
      if (text.length <= LIMIT) {
        this.#storage().setItem(key, text)
        return true
      }
    } catch {
      // Dropped below.
    }
    try {
      this.#storage().removeItem(key)
    } catch {
      // A storage that fails keeps nothing.
    }
    return false
  }

  /** Forgets all it kept of `machine`, every shelf and every version. */
  wipe(machine: string): void {
    const all = keyOf(machine)
    try {
      const storage = this.#storage()
      for (const key of this.#keys())
        if (key.startsWith(all)) storage.removeItem(key)
    } catch {
      // A storage that fails keeps nothing.
    }
  }

  /** The machines it keeps anything of. */
  machines(): string[] {
    try {
      const names = this.#keys().map((key) =>
        decodeURIComponent(key.slice(PREFIX.length, key.indexOf("/")))
      )
      return [...new Set(names)]
    } catch {
      return []
    }
  }

  /** The storage's keys that are the cache's. */
  #keys(): string[] {
    const storage = this.#storage()
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (key?.startsWith(PREFIX)) keys.push(key)
    }
    return keys
  }
}
