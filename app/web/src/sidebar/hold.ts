/**
 * The list holds still under the pointer (ADR 0065, decision 8): while
 * the Person's pointer is over it, each section's rows stay in the order
 * they were drawn in, saying what they say now; a row new to a section
 * comes last in it, so nothing above moves. What came, or would come up
 * as a call does, counts as updates the Person takes in at once. Pure, so
 * plain tests cover it.
 */
import type { Arranged, Row, Section } from "./arrange"

/** The list as it was drawn when the pointer came: each section's rows,
 * by key, in their order. */
export type Held = ReadonlyMap<string, ReadonlyMap<string, number>>

/** A row's key: its Space's and its own. */
export function rowKey(row: Row): string {
  return `${row.space.id}:${row.listed.id}`
}

/** What `arranged` draws now, held as it stands. */
export function held(arranged: Arranged): Held {
  const all = [...arranged.sections, ...arranged.shelves]
  return new Map(
    all.map((section) => [
      section.key,
      new Map(section.rows.map((row, i) => [rowKey(row), i])),
    ])
  )
}

/**
 * `next`, as `was` drew it: the sections as they are now, each one's held
 * rows in their held order, and its new ones last; and how many rows came,
 * or would come up, which wait until the Person takes them in.
 */
export function hold(
  next: Arranged,
  was: Held | undefined
): { arranged: Arranged; updates: number } {
  if (!was) return { arranged: next, updates: 0 }
  let updates = 0
  const draw = (section: Section): Section => {
    const order = was.get(section.key) ?? new Map<string, number>()
    const at = (row: Row) => order.get(rowKey(row))
    const kept = section.rows
      .filter((row) => at(row) !== undefined)
      .sort((a, b) => at(a)! - at(b)!)
    const came = section.rows.filter((row) => at(row) === undefined)
    updates += came.length
    // One that would stand higher than it is drawn came up, as a call.
    section.rows.forEach((row, i) => {
      if (i < kept.indexOf(row)) updates++
    })
    return { ...section, rows: [...kept, ...came] }
  }
  return {
    arranged: {
      ...next,
      sections: next.sections.map(draw),
      shelves: next.shelves.map(draw),
    },
    updates,
  }
}
