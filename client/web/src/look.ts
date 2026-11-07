/**
 * The page's side of the look (ADR 0007, decision 11): it only applies
 * what `banda look` resolved. Every variable goes on the root element,
 * over the defaults in globals.css, and the `dark` class follows the
 * scheme that shows. Until the first look comes, and outside the desktop,
 * the defaults show in the system's light or dark.
 */
import {
  type Bar,
  type Columns,
  type Drawer,
  type Groups,
  DEFAULT_BAR,
  DEFAULT_DRAWER,
  DEFAULT_OVERVIEW,
  DEFAULT_GROUPS,
  DEFAULT_COLUMNS,
  DEFAULT_KEYS,
  DEFAULT_MOTION,
  type Keys,
  type Look,
  type Motion,
  type Move,
  type Notify,
  type Overview,
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
  // The picture Banda's glass is made of, the dark one when Banda is dark,
  // which the desktop serves; its path and time in the address, so a new
  // wallpaper, or one rewritten in place, is a new picture (ADR 0023,
  // ADR 0030).
  const { wallpaper_dark: night, wallpaper: day } = look.desk
  const wallpaper = dark ? (night ?? day) : (day ?? night)
  if (wallpaper) {
    next["--desk-wallpaper"] =
      `url("${WALLPAPER_URL}?of=${encodeURIComponent(wallpaper.path)}&at=${wallpaper.modified}")`
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
  // How a Group's plate moves and how loud its colours are (ADR 0065,
  // decision 6); globals.css draws Banda's own without them.
  const { working, asking, saturation } = look.groups
  Object.assign(root.dataset, {
    groupWorking: working,
    groupAsking: asking,
    groupSaturation: saturation,
  })
  // `[motion] off`, or every move off: what CSS moves stays still too.
  root.toggleAttribute(
    "data-still",
    Object.values(look.motion).every((move) => move.kind === "off")
  )
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

/** `[bar]`: how it shows the workspaces. */
export function useLookBar(): Bar {
  return useLook((look) => look.bar, DEFAULT_BAR)
}

/** `[overview]`: how far it zooms out (ADR 0025, decision 7). */
export function useLookOverview(): Overview {
  return useLook((look) => look.overview, DEFAULT_OVERVIEW)
}

/** `[groups]`: how a Group of columns shows (ADR 0065). */
export function useLookGroups(): Groups {
  return useLook((look) => look.groups, DEFAULT_GROUPS)
}

/** `[drawer]`: how far it drops, and its Harness (ADR 0025, decision 8). */
export function useLookDrawer(): Drawer {
  return useLook((look) => look.drawer, DEFAULT_DRAWER)
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

/** The folder the settings files are in; none till the look comes. */
export function useLookConfig(): string {
  return useLook((look) => look.config, "")
}

const NO_SETTINGS: Look["settings"] = {}

/** Each key of each settings file, and where it comes from (ADR 0016). */
export function useLookSettings(): Look["settings"] {
  return useLook((look) => look.settings, NO_SETTINGS)
}
