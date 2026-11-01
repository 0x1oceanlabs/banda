/**
 * The window's toasts (ADR 0011, decision 2): a toast tells, the Mark
 * remembers, so each goes away by itself. Pure, so plain tests cover it.
 */
import type { Chime } from "@bandaso/ui/sound"

/** How long each call's toast shows, in ms: the louder, the longer. */
export const LIFE: Record<Chime, number> = {
  done: 5000,
  failed: 8000,
  asking: 12000,
}

/** How many toasts show at once; the rest are counted. */
export const SHOWN = 3

/** After the pointer leaves the toasts, each shows at least this long. */
export const AFTER_HOLD = 1500

/** A toast of one call, by its key, until a time in ms. */
export type Toast = { key: string; chime: Chime; until: number }

/** The toasts with a call's toast on top, in place of one it had. */
export function told(
  toasts: readonly Toast[],
  key: string,
  chime: Chime,
  now: number
): Toast[] {
  const others = toasts.filter((toast) => toast.key !== key)
  return [{ key, chime, until: now + LIFE[chime] }, ...others]
}

/** The toasts still showing at `now`. */
export function alive(toasts: readonly Toast[], now: number): Toast[] {
  return toasts.filter((toast) => toast.until > now)
}

/** The toasts after the pointer held them `ms` and then let go at `now`. */
export function released(
  toasts: readonly Toast[],
  ms: number,
  now: number
): Toast[] {
  return toasts.map((toast) => ({
    ...toast,
    until: Math.max(toast.until + ms, now + AFTER_HOLD),
  }))
}
