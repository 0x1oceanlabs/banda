/**
 * How a snoozed Thread is read against a clock (ADR 0074): whether it
 * sleeps, and when it woke by itself. The engine keeps the snooze and
 * fires nothing at its time, so every reader works it out here. Pure, so
 * a Thread's parts read it without the Pane's API.
 */
import type { ListedSnooze } from "../pane"

type Read = Pick<ListedSnooze, "until" | "woke"> | undefined

/** Whether a Thread under `snooze` sleeps at `now`: nothing woke it, and
 * its time has not come. */
export function sleeps(snooze: Read, now: number): boolean {
  if (!snooze || snooze.woke) return false
  return snooze.until === undefined || snooze.until > now
}

/**
 * When a Thread under `snooze` woke by itself, at `now`: its time came, or
 * what calls its Person woke it early. Nothing while it sleeps, or when
 * its Person woke it, by hand or by writing to it.
 */
export function wokeOf(snooze: Read, now: number): number | undefined {
  if (!snooze) return undefined
  if (snooze.woke)
    return snooze.woke.by === "woken" || snooze.woke.by === "message"
      ? undefined
      : snooze.woke.at
  return snooze.until !== undefined && snooze.until <= now
    ? snooze.until
    : undefined
}
