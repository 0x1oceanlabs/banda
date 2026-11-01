/**
 * The look's words for TypeScript (ADR 0007): what `bandaso look` prints,
 * and which of its schemes shows.
 */
import type { Look } from "./generated/look/Look"
import type { Motion } from "./generated/look/Motion"

export type { Look } from "./generated/look/Look"
export type { Problem } from "./generated/look/Problem"
export type { Source } from "./generated/look/Source"
export type { Motion } from "./generated/look/Motion"
export type { Move } from "./generated/look/Move"
export type { Spring } from "./generated/look/Spring"
export type { Easing } from "./generated/look/Easing"

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
