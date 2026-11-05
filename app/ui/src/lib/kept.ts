/**
 * A record this window keeps for its Person in its storage, by key: the
 * Person's own marks, as "seen" and "archived" (ADR 0005, decision 8).
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

  const put = (id: string, value: V) => {
    const others = Object.entries(read()).filter(([other]) => other !== id)
    here = Object.fromEntries([...others.slice(-(keep - 1)), [id, value]])
    try {
      localStorage.setItem(key, JSON.stringify(here))
    } catch {
      // `here` holds it.
    }
    heard.forEach((hear) => hear())
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
    use: () => useSyncExternalStore(listen, read, () => none),
  }
}
