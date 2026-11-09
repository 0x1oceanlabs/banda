/**
 * How a put-off Thread is read against a clock (ADR 0074): whether it
 * sleeps, and when it woke by itself. The engine keeps the Later and
 * fires nothing at its time, so every reader works it out here. Pure, so
 * a Thread's parts read it without the Pane's API.
 */
import type { ListedLater } from "../pane"

type Read = Pick<ListedLater, "until" | "woke"> | undefined

/** Whether a Thread under `later` sleeps at `now`: nothing woke it, and
 * its time has not come. */
export function sleeps(later: Read, now: number): boolean {
  if (!later || later.woke) return false
  return later.until === undefined || later.until > now
}

/**
 * When a Thread under `later` woke by itself, at `now`: its time came, or
 * what calls its Person woke it early. Nothing while it sleeps, or when
 * its Person woke it, by hand or by writing to it.
 */
export function wokeOf(later: Read, now: number): number | undefined {
  if (!later) return undefined
  if (later.woke)
    return later.woke.by === "woken" || later.woke.by === "message"
      ? undefined
      : later.woke.at
  return later.until !== undefined && later.until <= now
    ? later.until
    : undefined
}
