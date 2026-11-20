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

/** A version Banda publishes, as `feed.rs` reads one: three numbers, and
 * a Dev's own after `-dev.`; none for any other text. */
function versionOf(text: string): number[] | undefined {
  const found = /^(\d+)\.(\d+)\.(\d+)(?:-dev\.(\d+))?$/.exec(text)
  if (!found) return undefined
  // A plain version is above every Dev of the same numbers.
  return [1, 2, 3]
    .map((at) => Number(found[at]))
    .concat(found[4] === undefined ? Infinity : Number(found[4]))
}

/** Whether version `a` is above `b`, as the engine orders them
 * (`feed::is_above`). Nothing is above, or below, a version Banda does
 * not publish. */
export function above(a: string, b: string): boolean {
  const [one, other] = [versionOf(a), versionOf(b)]
  if (!one || !other) return false
  const at = one.findIndex((part, index) => part !== other[index])
  return at !== -1 && one[at]! > other[at]!
}
