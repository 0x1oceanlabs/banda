/**
 * The look the window follows (ADR 0007), for every Pane to read its part
 * of, as the browser reads `browser.toml`'s. The window keeps it
 * (`app/web/src/look.ts`); until the first look comes, and outside the
 * desktop, there is none and each reader takes Banda's own.
 */
import { useSyncExternalStore } from "react"
import type { Look } from "@banda/contract/look"

let look: Look | null = null
const listeners = new Set<() => void>()

function subscribe(changed: () => void): () => void {
  listeners.add(changed)
  return () => listeners.delete(changed)
}

/** The look now; none before the first. */
export function currentLook(): Look | null {
  return look
}

/** The window's: the look it now follows. */
export function takeLook(next: Look): void {
  look = next
  for (const listener of listeners) listener()
}

/** `pick` of the look, again on each new one; `before` till it comes.
 * `pick` hands back a part of the look as it is, so it stays the same
 * object until the look changes. */
export function useLook<T>(pick: (look: Look) => T, before: T): T {
  return useSyncExternalStore(subscribe, () => (look ? pick(look) : before))
}
