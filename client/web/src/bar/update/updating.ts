/**
 * The update widget's timings and how it names a version (ADR 0072, ADR
 * 0131). Pure, so plain tests cover it; Update.tsx and machines.ts use it.
 */

/** How long a download runs before the bar shows it: a Dev that differs
 * by a few blocks is down sooner, and the bar would only flicker. */
export const SHOW_AFTER = 2000

/** How long a Banda that restarted into a new version says so on its own
 * (ADR 0072, decision 4). */
export const UPDATED_FOR = 6000

/** A version as the popover names it: a Dev by its number (`dev.66`), a
 * Stable whole (`0.2.0`). */
export function shortOf(version: string): string {
  return /-(.+)$/.exec(version)?.[1] ?? version
}
