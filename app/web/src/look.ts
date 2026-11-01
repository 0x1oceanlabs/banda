/**
 * The page's side of the look (ADR 0007, decision 11): it only applies
 * what `bandaso look` resolved. Every variable goes on the root element,
 * over the defaults in globals.css, and the `dark` class follows the
 * scheme that shows. Until the first look comes, and outside the desktop,
 * the defaults show in the system's light or dark.
 */
import { useSyncExternalStore } from "react"
import { type Look, type Problem, shown } from "@bandaso/contract/look"
import type { Host } from "./host"

const system = matchMedia("(prefers-color-scheme: dark)")
let look: Look | null = null
let applied = new Set<string>()
const listeners = new Set<() => void>()
const NONE: Problem[] = []

/** Paints `root` in `look`, or in the defaults when there is none. */
export function apply(
  root: HTMLElement,
  look: Look | null,
  systemDark: boolean,
  before: ReadonlySet<string>
): Set<string> {
  if (!look) {
    root.classList.toggle("dark", systemDark)
    return new Set(before)
  }
  const { dark, colors } = shown(look, systemDark)
  const next: Record<string, string> = { ...look.vars, ...colors }
  for (const name of before) {
    if (!(name in next)) root.style.removeProperty(name)
  }
  for (const [name, value] of Object.entries(next)) {
    root.style.setProperty(name, value)
  }
  root.classList.toggle("dark", dark)
  return new Set(Object.keys(next))
}

function paint() {
  applied = apply(document.documentElement, look, system.matches, applied)
}

/** Follows the desktop's look, and the system's light or dark. */
export function followLook(host: Host | undefined): void {
  paint()
  system.addEventListener("change", paint)
  if (!host) return
  const take = (next: Look) => {
    look = next
    paint()
    for (const listener of listeners) listener()
  }
  void host.look.current().then((first) => {
    if (first && !look) take(first)
  })
  host.look.listen(take)
}

/** What is wrong in the look's files now, for the bar to say. */
export function useLookProblems(): Problem[] {
  return useSyncExternalStore(
    (changed) => {
      listeners.add(changed)
      return () => listeners.delete(changed)
    },
    () => look?.problems ?? NONE
  )
}
