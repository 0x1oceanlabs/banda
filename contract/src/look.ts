/**
 * The look's words for TypeScript (ADR 0007): what `banda look` prints,
 * and which of its schemes shows.
 */
import type { Browser } from "./generated/look/Browser"
import type { Keys } from "./generated/look/Keys"
import type { Look } from "./generated/look/Look"
import type { Columns } from "./generated/look/Columns"
import type { Motion } from "./generated/look/Motion"

export type { Look } from "./generated/look/Look"
export type { Desk } from "./generated/look/Desk"
export type { Wallpaper } from "./generated/look/Wallpaper"
export type { Material } from "./generated/look/Material"
export type { SidebarStyle } from "./generated/look/SidebarStyle"
export type { Browser } from "./generated/look/Browser"
export type { Tabs } from "./generated/look/Tabs"
export type { Problem } from "./generated/look/Problem"
export type { Call } from "./generated/look/Call"
export type { Families } from "./generated/look/Families"
export type { Family } from "./generated/look/Family"
export type { Notify } from "./generated/look/Notify"
export type { Quiet } from "./generated/look/Quiet"
export type { Sound } from "./generated/look/Sound"
export type { System } from "./generated/look/System"
export type { Toasts } from "./generated/look/Toasts"
export type { Source } from "./generated/look/Source"
export type { Listed } from "./generated/look/Listed"
export type { Motion } from "./generated/look/Motion"
export type { Columns } from "./generated/look/Columns"
export type { Center } from "./generated/look/Center"
export type { Display } from "./generated/look/Display"
export type { Bind } from "./generated/look/Bind"
export type { Keys } from "./generated/look/Keys"
export type { Move } from "./generated/look/Move"
export type { Spring } from "./generated/look/Spring"
export type { Easing } from "./generated/look/Easing"

/**
 * Where the desktop serves the picture Banda's glass is made of, the
 * look's wallpaper and no other file (ADR 0023).
 */
export const WALLPAPER_URL = "app://banda/desk/wallpaper"

/** Banda's own columns, niri's: what `banda look` gives with no files. */
export const DEFAULT_COLUMNS: Columns = {
  presets: ["1/3", "1/2", "2/3", "1"],
  heights: ["1/3", "1/2", "2/3"],
  default: "1/2",
  alone: "1",
  center: "never",
  display: "stack",
  min: 30,
}

/** Banda's own motion, niri's springs: what `banda look` gives with no
 * files, for the first frame and outside the desktop. */
export const DEFAULT_MOTION: Motion = {
  workspace: {
    kind: "spring",
    dampingRatio: 1,
    stiffness: 800,
    epsilon: 0.0001,
  },
  strip: { kind: "spring", dampingRatio: 1, stiffness: 800, epsilon: 0.0001 },
  move: { kind: "spring", dampingRatio: 1, stiffness: 800, epsilon: 0.0001 },
  resize: { kind: "spring", dampingRatio: 1, stiffness: 800, epsilon: 0.0001 },
  open: { kind: "easing", durationMs: 150, bezier: [0.16, 1, 0.3, 1] },
  close: { kind: "easing", durationMs: 150, bezier: [0.5, 1, 0.89, 1] },
}

/** The scheme that shows, and whether it is the dark one: the look's
 * mode, or the system's when the look follows it. A theme with one
 * scheme shows that one whatever the system says. */
export function shown(
  look: Look,
  systemDark: boolean
): { dark: boolean; colors: Record<string, string> } {
  const { light, dark } = look.schemes
  const wantsDark =
    look.mode === "dark" || (look.mode === "system" && systemDark)
  if (wantsDark ? dark : !light) return { dark: true, colors: dark ?? {} }
  return { dark: false, colors: light ?? {} }
}

/** No keys of the Person's: what `banda look` gives with no keys.toml. */
export const DEFAULT_KEYS: Keys = { file: "", binds: [] }

/**
 * A module's settings file as the look resolved it, by its name: what
 * `files` holds, typed as its module says, or `before` when the look has
 * none of it yet.
 */
export function fileOf<T>(files: Look["files"], name: string, before: T): T {
  return (files[name] as T | undefined) ?? before
}

/** Banda's browser, as `banda look` gives it with no `browser.toml`: for
 * before the first look and outside the desktop. */
export const DEFAULT_BROWSER: Browser = {
  tabs: "top",
  search: "https://duckduckgo.com/?q=%s",
  pinned: [],
  blocker: true,
}
