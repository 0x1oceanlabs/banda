/**
 * The page's side of the look (ADR 0007, decision 11): it only applies
 * what `banda look` resolved. Every variable goes on the root element,
 * over the defaults in globals.css, and the `dark` class follows the
 * scheme that shows. Until the first look comes, and outside the desktop,
 * the defaults show in the system's light or dark.
 */
import { useSyncExternalStore } from "react"
import {
  type Columns,
  DEFAULT_COLUMNS,
  DEFAULT_MOTION,
  type Look,
  type Motion,
  type Move,
  type Notify,
  type Problem,
  shown,
} from "@banda/contract/look"
import { DEFAULT_SIDEBAR, type Sidebar } from "@banda/contract/sidebar"
import { DEFAULT_SOUND, type SoundSettings } from "@banda/ui/sound"
import { DEFAULT_NOTIFY } from "./calls/settings"
import type { Host } from "./host"

// Outside a window, as in tests, nothing is asked of the system.
const ask = (query: string) =>
  typeof matchMedia === "function" ? matchMedia(query) : undefined
const system = ask("(prefers-color-scheme: dark)")
const reduced = ask("(prefers-reduced-motion: reduce)")
const STILL: Move = { kind: "off" }
let look: Look | null = null
let applied = new Set<string>()
const listeners = new Set<() => void>()
const subscribe = (changed: () => void) => {
  listeners.add(changed)
  return () => listeners.delete(changed)
}
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
  applied = apply(
    document.documentElement,
    look,
    system?.matches ?? false,
    applied
  )
}

/** Follows the desktop's look, and the system's light or dark. */
export function followLook(host: Host | undefined): void {
  paint()
  system?.addEventListener("change", paint)
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

/** How `event` moves now: as the look says, Banda's own before it comes,
 * and not at all when the system asks for reduced motion. */
export function moveOf(event: keyof Motion): Move {
  if (reduced?.matches) return STILL
  return (look?.motion ?? DEFAULT_MOTION)[event]
}

/** The widths columns take, and where the focused one scrolls to. */
export function columnsOf(): Columns {
  return look?.columns ?? DEFAULT_COLUMNS
}

/** What is wrong in the look's files now, for the bar to say. */
export function useLookProblems(): Problem[] {
  return useSyncExternalStore(subscribe, () => look?.problems ?? NONE)
}

/**
 * How the window tells its Person of a call, `[notify]` (ADR 0011); the
 * defaults till the look comes.
 */
export function useLookNotify(): Notify {
  return useSyncExternalStore(subscribe, () => look?.notify ?? DEFAULT_NOTIFY)
}

/** The sounds the look chose, `[sound]` (ADR 0009); the defaults till then. */
export function useLookSound(): SoundSettings {
  return useSyncExternalStore(subscribe, () => look?.sound ?? DEFAULT_SOUND)
}

/** How the sidebar is arranged, from `sidebar.toml` (ADR 0008); Banda's
 * own till then. */
export function useLookSidebar(): Sidebar {
  return useSyncExternalStore(
    (changed) => {
      listeners.add(changed)
      return () => listeners.delete(changed)
    },
    () => look?.sidebar ?? DEFAULT_SIDEBAR
  )
}
