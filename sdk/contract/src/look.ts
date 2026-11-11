/**
 * The look's words for TypeScript (ADR 0007): what `banda look` prints,
 * and which of its schemes shows.
 */
import type { Keys } from "./generated/look/Keys"
import type { Look } from "./generated/look/Look"
import type { Bar } from "./generated/look/Bar"
import type { Drawer } from "./generated/look/Drawer"
import type { Groups } from "./generated/look/Groups"
import type { Overview } from "./generated/look/Overview"
import type { Columns } from "./generated/look/Columns"
import type { Motion } from "./generated/look/Motion"

export type { Look } from "./generated/look/Look"
export type { Device } from "./generated/look/Device"
export {
  BANDA,
  RENAMED,
  TOKENS,
  type Token,
  type TokenGroup,
  type TokenKind,
} from "./generated/look/tokens"
export type { Desk } from "./generated/look/Desk"
export type { Wallpaper } from "./generated/look/Wallpaper"
export type { Material } from "./generated/look/Material"
export type { SidebarStyle } from "./generated/look/SidebarStyle"
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
export type { Bar } from "./generated/look/Bar"
export type { Setting } from "./generated/look/Setting"
export type { Drawer } from "./generated/look/Drawer"
export type { Groups } from "./generated/look/Groups"
export type { GroupAsking } from "./generated/look/GroupAsking"
export type { GroupSaturation } from "./generated/look/GroupSaturation"
export type { GroupWorking } from "./generated/look/GroupWorking"
export type { Overview } from "./generated/look/Overview"
export type { Workspaces } from "./generated/look/Workspaces"
export type { Center } from "./generated/look/Center"
export type { Display } from "./generated/look/Display"
export type { Bind } from "./generated/look/Bind"
export type { Keys } from "./generated/look/Keys"
export type { Mod } from "./generated/look/Mod"
export type { ActionKeys } from "./generated/look/ActionKeys"
export type { KeyInForce } from "./generated/look/KeyInForce"
export type { Move } from "./generated/look/Move"
export type { Spring } from "./generated/look/Spring"
export type { Easing } from "./generated/look/Easing"

/**
 * Where the desktop serves the picture Banda's glass is made of, the
 * look's wallpaper and no other file (ADR 0023).
 */
export const WALLPAPER_URL = "app://banda/desk/wallpaper"

/** The bar, as `banda look` gives it with no files. */
export const DEFAULT_BAR: Bar = {
  workspaces: "numbers",
  left: ["workspaces.list", "window.flow"],
  center: ["sidebar.counts"],
  right: [
    "workspaces.aside",
    "terminal.ports",
    "harnesses.limits",
    "notifications.recent",
    "clock.now",
  ],
}

/** The drawer, as `banda look` gives it with no files (ADR 0025). */
export const DEFAULT_DRAWER: Drawer = { height: 0.6 }

/** The overview, as `banda look` gives it with no files (ADR 0025). */
export const DEFAULT_OVERVIEW: Overview = { zoom: 0.35 }

/** How a Group shows, as `banda look` gives it with no files (ADR 0065). */
export const DEFAULT_GROUPS: Groups = {
  handle: false,
  working: "breath",
  asking: "twice",
  saturation: "normal",
}

/** Banda's own columns, niri's: what `banda look` gives with no files. */
export const DEFAULT_COLUMNS: Columns = {
  presets: ["1/3", "1/2", "2/3", "1"],
  heights: ["1/3", "1/2", "2/3"],
  default: "1/2",
  alone: "1",
  center: "never",
  display: "stack",
  min: 30,
  snap: 8,
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
  overview: {
    kind: "spring",
    dampingRatio: 1,
    stiffness: 800,
    epsilon: 0.0001,
  },
}

/** The scheme that shows, and whether it is the dark one: the look's
 * mode, or the system's when the look follows it. A theme with one
 * scheme shows that one whatever the system says. Over glass, that
 * scheme's glass (ADR 0100, decision 4). */
export function shown(
  look: Look,
  systemDark: boolean
): { dark: boolean; colors: Record<string, string> } {
  const { light, dark, light_glass, dark_glass } = look.schemes
  const glass = look.desk.glass
  const wantsDark =
    look.mode === "dark" || (look.mode === "system" && systemDark)
  if (wantsDark ? dark : !light) {
    return { dark: true, colors: (glass && dark_glass) || dark || {} }
  }
  return { dark: false, colors: (glass && light_glass) || light || {} }
}

/** A colour as a window's ground takes it before the page paints: a
 * six-digit hex colour, or none. */
export const windowGround = (colour: string | undefined): string | undefined =>
  colour && /^#[0-9a-f]{6}$/i.test(colour) ? colour : undefined

/** No keys of the Person's: what `banda look` gives with no keys.toml. */
export const DEFAULT_KEYS: Keys = {
  file: "",
  mod: { alt: true, ctrl: false, super: false },
  binds: [],
  actions: [],
}

/**
 * A module's settings file the look resolves into `files`: its name, and
 * Banda's own for before the first look. Its module exports it, typed as
 * the file's value.
 */
export interface ModuleFile<T> {
  readonly name: string
  readonly before: T
}

/** `file` as the look resolved it, or its `before` when the look has none
 * of it yet. */
export function fileOf<T>(files: Look["files"], file: ModuleFile<T>): T {
  return (files[file.name] as T | undefined) ?? file.before
}
