/**
 * The look's words for TypeScript (ADR 0007): what `bandaso look` prints,
 * and which of its schemes shows.
 */
import type { Look } from "./generated/look/Look"
import type { Columns } from "./generated/look/Columns"
import type { Motion } from "./generated/look/Motion"

export type { Look } from "./generated/look/Look"
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
export type { Motion } from "./generated/look/Motion"
export type { Columns } from "./generated/look/Columns"
export type { Center } from "./generated/look/Center"
export type { Move } from "./generated/look/Move"
export type { Spring } from "./generated/look/Spring"
export type { Easing } from "./generated/look/Easing"

/** Banda's own columns, niri's: what `bandaso look` gives with no files. */
export const DEFAULT_COLUMNS: Columns = {
  presets: ["1/3", "1/2", "2/3", "1"],
  default: "1/2",
  center: "never",
}

/** Banda's own motion, niri's springs: what `bandaso look` gives with no
 * files, for the first frame and outside the desktop. */
export const DEFAULT_MOTION: Motion = {
  workspace: {
    kind: "spring",
    dampingRatio: 1,
    stiffness: 800,
    epsilon: 0.0001,
  },
  strip: { kind: "spring", dampingRatio: 1, stiffness: 800, epsilon: 0.0001 },
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
