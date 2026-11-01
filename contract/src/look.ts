/**
 * The look's words for TypeScript (ADR 0007): what `bandaso look` prints,
 * and which of its schemes shows.
 */
import type { Look } from "./generated/look/Look"

export type { Look } from "./generated/look/Look"
export type { Problem } from "./generated/look/Problem"
export type { Source } from "./generated/look/Source"

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
