/**
 * The one rule that keeps a card from running out from under a click (ADR
 * 0098, decision 6, as amended 2026-11-14): the order does not change
 * while the pointer is over the list. What each card says stays live, a
 * card that left the tab goes at once, and one new to it waits for the
 * pointer to leave. It is the window's own, as the pointer is: whatever
 * decides the list (`sidebarOf`), the window keeps it still under the
 * hand. Pure, so plain tests cover it.
 */
import type { Item } from "./flat"

/** Whether `item` draws a card: a Thread's, or a Project's that waits. */
const card = (item: Item) =>
  item.kind === "card" || item.piece.kind === "project"

/**
 * `fresh` in the order `drawn` drew it: each item of `drawn` where it
 * was, saying what `fresh` says of it now; a card in the part it was
 * drawn in. An item `fresh` has nowhere is dropped; one only `fresh` has
 * is not added. With no card left, `fresh` as it is, so inbox zero and a
 * tab's empty words show at once.
 */
export function stillOf(
  drawn: readonly Item[],
  fresh: readonly Item[]
): Item[] {
  const byKey = new Map(fresh.map((item) => [item.key, item]))
  const still = drawn.flatMap((item): Item[] => {
    const latest = byKey.get(item.key)
    if (latest?.kind === "piece" && item.kind === "piece") return [latest]
    if (latest?.kind === "card" && item.kind === "card")
      return [{ ...item, entry: latest.entry }]
    return []
  })
  return still.some(card) ? still : [...fresh]
}
