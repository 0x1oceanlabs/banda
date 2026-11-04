import type { Limits, LimitWindow } from "@banda/contract/harnesses"
import { DAY, HOUR, MINUTE, clock } from "@banda/ui/lib/words"

/** A reset that passed is empty until the engine reads again. */
export function usedOf(window: LimitWindow, now: number): number {
  return window.resets_at !== undefined && window.resets_at <= now
    ? 0
    : Math.max(0, Math.min(100, window.used))
}

export function toneOf(used: number, warn: number): string {
  return used >= 100
    ? "text-destructive"
    : used >= warn
      ? "text-warning"
      : "text-muted-foreground"
}

/** Even spending, only when the provider gave both ends of the window. */
export function elapsedOf(
  window: LimitWindow,
  now: number
): number | undefined {
  if (
    window.resets_at === undefined ||
    !window.lasts ||
    window.resets_at <= now
  )
    return undefined
  return Math.max(
    0,
    Math.min(100, (1 - (window.resets_at - now) / window.lasts) * 100)
  )
}

/** How a window is spent against even spending, as the Usage Pane says
 * it; none without both ends of the window. */
export function paceOf(
  window: LimitWindow,
  now: number
): { words: string; tone: string } | undefined {
  const used = usedOf(window, now)
  if (used >= 100) return { words: "Out", tone: "text-destructive" }
  const elapsed = elapsedOf(window, now)
  if (elapsed === undefined) return undefined
  if (used - elapsed > 5)
    return { words: "Ahead of pace", tone: "text-warning" }
  if (elapsed - used > 5)
    return { words: "Under pace", tone: "text-muted-foreground" }
  return { words: "On pace", tone: "text-muted-foreground" }
}

export function remaining(at: number, now: number): string {
  const minutes = Math.max(1, Math.ceil((at - now) / MINUTE))
  if (minutes >= DAY / MINUTE)
    return `${Math.floor(minutes / (DAY / MINUTE))}d ${Math.floor((minutes % (DAY / MINUTE)) / 60)}h`
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
  return `${minutes}m`
}

export function resetWords(window: LimitWindow, now: number): string {
  if (window.resets_at === undefined) return "Reset unknown"
  if (window.resets_at <= now) return "Reset passed · awaiting read"
  return `${usedOf(window, now) >= 100 ? "back in" : "resets in"} ${remaining(window.resets_at, now)}`
}

/** An estimate from the current window's average, never a rate forecast
 * without a start, or after the window ended. */
export function paceWords(
  window: LimitWindow,
  now: number
): string | undefined {
  const elapsed = elapsedOf(window, now)
  const used = usedOf(window, now)
  if (
    window.kind !== "weekly" ||
    elapsed === undefined ||
    elapsed <= 0 ||
    used >= 100 ||
    used - elapsed <= 5
  )
    return undefined
  const out =
    window.resets_at! - window.lasts! + (window.lasts! * elapsed) / used
  return `At this pace the week runs out ${clock(out, now)}, ${remaining(window.resets_at!, out)} before it resets`
}

export function staleOf(limits: Limits, now: number): boolean {
  return (
    limits.failed !== undefined &&
    (limits.read_at === undefined || now - limits.read_at > HOUR / 2)
  )
}

export function tooltipOf(limits: readonly Limits[], now: number): string {
  return limits
    .filter((l) => l.windows.length > 0)
    .map(
      (l) =>
        `${l.name}: ${l.windows.map((w) => `${w.label} ${Math.round(usedOf(w, now))}% used, ${resetWords(w, now)}`).join(", ")}${l.failed ? ` · ${l.failed.why}` : ""}`
    )
    .join(" · ")
}
