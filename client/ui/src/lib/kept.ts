/**
 * A record this window keeps for its Person in its storage, by key: what
 * stays the device's, as the woke rows' marks, a draft or the Banda menu's
 * recent picks (ADR 0096, decision 11). A Thread's seen and archive are
 * its host's (ADR 0096).
 * Every part of the window, and every other window on the same storage,
 * hears a change at once. A window whose storage fails keeps it until it
 * closes.
 */
import { useSyncExternalStore } from "react"

export type Kept<V> = {
  /** The record now. */
  read: () => Readonly<Record<string, V>>
  /** Keeps `value` for `id`, the latest kept last: an old one falls off. */
  put: (id: string, value: V) => void
  /** Forgets what it kept for `id`. */
  drop: (id: string) => void
  /** The record, kept current. */
  use: () => Readonly<Record<string, V>>
}

/**
 * @param key where the storage keeps it
 * @param isValue whether a stored value is one: anything else is dropped
 * @param keep how many ids it remembers
 */
export function kept<V>(
  key: string,
  isValue: (value: unknown) => value is V,
  keep = 500
): Kept<V> {
  const none: Readonly<Record<string, V>> = {}
  const heard = new Set<() => void>()
  let here: Readonly<Record<string, V>> | undefined

  const load = () => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null")
      here =
        typeof value === "object" && value !== null
          ? Object.fromEntries(
              Object.entries(value).filter((pair): pair is [string, V] =>
                isValue(pair[1])
              )
            )
          : none
    } catch {
      here ??= none
    }
    return here
  }
  const read = () => here ?? load()

  const keepAll = (all: Readonly<Record<string, V>>) => {
    here = all
    try {
      localStorage.setItem(key, JSON.stringify(here))
    } catch {
      // `here` holds it.
    }
    heard.forEach((hear) => hear())
  }
  // A change starts from what is kept now: another window may have
  // changed it while none here heard.
  const put = (id: string, value: V) => {
    const others = Object.entries(load()).filter(([other]) => other !== id)
    keepAll(Object.fromEntries([...others.slice(-(keep - 1)), [id, value]]))
  }
  const drop = (id: string) => {
    if (!(id in load())) return
    keepAll(
      Object.fromEntries(
        Object.entries(read()).filter(([other]) => other !== id)
      )
    )
  }

  const listen = (hear: () => void) => {
    heard.add(hear)
    // Another window on the same storage changed it.
    const elsewhere = (event: StorageEvent) => {
      if (event.key !== key) return
      load()
      hear()
    }
    window.addEventListener("storage", elsewhere)
    return () => {
      heard.delete(hear)
      window.removeEventListener("storage", elsewhere)
    }
  }

  return {
    read,
    put,
    drop,
    use: () => useSyncExternalStore(listen, read, () => none),
  }
}
