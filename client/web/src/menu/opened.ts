/**
 * What the Person chose in the Banda menu, how often and how lately, so
 * among equal matches what they open often and lately ranks first
 * (ADR 0017, decision 5), as Firefox's frecency does.
 */
import { kept } from "@banda/ui/lib/kept"
import { DAY } from "@banda/ui/lib/words"

/** How many times a row was chosen, and when last. */
export type Use = { times: number; at: number }

const uses = kept(
  "banda.menu.opened",
  (value: unknown): value is Use =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as Use).times === "number" &&
    typeof (value as Use).at === "number"
)

/** Keeps that the row `id` was chosen now. */
export function opened(id: string, now = Date.now()): void {
  uses.put(id, { times: (uses.read()[id]?.times ?? 0) + 1, at: now })
}

/** The rows chosen, kept current. */
export const useOpened = uses.use

/** How much a row counts: its times, the more the later it was last. */
export function weightOf(use: Use | undefined, now: number): number {
  if (!use) return 0
  const days = (now - use.at) / DAY
  const lately = days < 1 ? 4 : days < 7 ? 2 : days < 30 ? 1 : 0.5
  return use.times * lately
}
