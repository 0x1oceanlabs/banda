/**
 * The look the window follows (ADR 0007), for every Pane to read its part
 * of, as the browser reads `browser.toml`'s. The window keeps it
 * (`app/web/src/look.ts`); until the first look comes, and outside the
 * desktop, there is none and each reader takes Banda's own.
 */
import { useSyncExternalStore } from "react"
import { fileOf, type Look, type ModuleFile } from "@banda/contract/look"

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

/** A module's settings file as the look resolves it, again on each new
 * look; its `before` till it comes. */
export function useFile<T>(file: ModuleFile<T>): T {
  return useLook((look) => fileOf(look.files, file), file.before)
}

/** {@link useFile} outside a component: the file as the look resolves it
 * now, its `before` till the first look comes. */
export function fileNow<T>(file: ModuleFile<T>): T {
  return look ? fileOf(look.files, file) : file.before
}

/** Calls `onChange` when the window turns light or dark, or its look
 * sets new colours on the root (ADR 0007): after they are painted, so a
 * reader of the root's style reads the new ones. */
export function onThemeChange(onChange: () => void): () => void {
  const watching = new MutationObserver(onChange)
  watching.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  })
  return () => watching.disconnect()
}
