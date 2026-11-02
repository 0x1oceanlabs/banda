/**
 * The page's side of the look (ADR 0007, decision 11): it only applies
 * what `banda look` resolved. Every variable goes on the root element,
 * over the defaults in globals.css, and the `dark` class follows the
 * scheme that shows. Until the first look comes, and outside the desktop,
 * the defaults show in the system's light or dark.
 */
import {
  type Columns,
  DEFAULT_COLUMNS,
  DEFAULT_KEYS,
  DEFAULT_MOTION,
  type Keys,
  type Look,
  type Motion,
  type Move,
  type Notify,
  type Problem,
  shown,
  WALLPAPER_URL,
} from "@banda/contract/look"
import { DEFAULT_SIDEBAR, type Sidebar } from "@banda/contract/sidebar"
import { currentLook, takeLook, useLook } from "@banda/ui/lib/look"
import { DEFAULT_SOUND, type SoundSettings } from "@banda/ui/sound"
import { DEFAULT_NOTIFY } from "./calls/settings"
import type { Host } from "./host"

// Outside a window, as in tests, nothing is asked of the system.
const ask = (query: string) =>
  typeof matchMedia === "function" ? matchMedia(query) : undefined
const system = ask("(prefers-color-scheme: dark)")
const reduced = ask("(prefers-reduced-motion: reduce)")
const STILL: Move = { kind: "off" }
let applied = new Set<string>()
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
  // The picture Banda's glass is made of, which the desktop serves; its
  // path in the address, so a new wallpaper is a new picture (ADR 0023).
  const { wallpaper } = look.desk
  if (wallpaper) {
    next["--desk-wallpaper"] =
      `url("${WALLPAPER_URL}?of=${encodeURIComponent(wallpaper)}")`
  }
  for (const name of before) {
    if (!(name in next)) root.style.removeProperty(name)
  }
  for (const [name, value] of Object.entries(next)) {
    root.style.setProperty(name, value)
  }
  root.classList.toggle("dark", dark)
  root.toggleAttribute("data-glass", look.desk.glass)
  root.dataset.material = look.desk.material
  root.dataset.sidebar = look.desk.sidebar
  return new Set(Object.keys(next))
}

function paint() {
  applied = apply(
    document.documentElement,
    currentLook(),
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
    takeLook(next)
    paint()
  }
  void host.look.current().then((first) => {
    if (first && !currentLook()) take(first)
  })
  host.look.listen(take)
}

/** How `event` moves now: as the look says, Banda's own before it comes,
 * and not at all when the system asks for reduced motion. */
export function moveOf(event: keyof Motion): Move {
  if (reduced?.matches) return STILL
  return (currentLook()?.motion ?? DEFAULT_MOTION)[event]
}

/** The widths columns take, and where the focused one scrolls to. */
export function columnsOf(): Columns {
  return currentLook()?.columns ?? DEFAULT_COLUMNS
}

/** `[columns]`, for what draws again when the look changes them. */
export function useLookColumns(): Columns {
  return useLook((look) => look.columns, DEFAULT_COLUMNS)
}

/** What is wrong in the look's files now, for the bar to say. */
export function useLookProblems(): Problem[] {
  return useLook((look) => look.problems, NONE)
}

/**
 * How the window tells its Person of a call, `[notify]` (ADR 0011); the
 * defaults till the look comes.
 */
export function useLookNotify(): Notify {
  return useLook((look) => look.notify, DEFAULT_NOTIFY)
}

/** The sounds the look chose, `[sound]` (ADR 0009); the defaults till then. */
export function useLookSound(): SoundSettings {
  return useLook((look) => look.sound, DEFAULT_SOUND)
}

/** How the sidebar is arranged, from `sidebar.toml` (ADR 0008); Banda's
 * own till then. */
export function useLookSidebar(): Sidebar {
  return useLook((look) => look.sidebar, DEFAULT_SIDEBAR)
}

/** The keys the Person bound in `keys.toml`; none till the look comes. */
export function useLookKeys(): Keys {
  return useLook((look) => look.keys, DEFAULT_KEYS)
}

const NO_SETTINGS: Look["settings"] = {}

/** Each key of each settings file, and where it comes from (ADR 0016). */
export function useLookSettings(): Look["settings"] {
  return useLook((look) => look.settings, NO_SETTINGS)
}
