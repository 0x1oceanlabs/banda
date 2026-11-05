/**
 * The list holds still under the pointer (ADR 0065, decision 8): while
 * the Person's pointer is over it, its rows stay where they were drawn,
 * with what they say now, and what would move or come counts as updates
 * the Person takes in at once. Pure, so plain tests cover it.
 */
import type { Arranged, Row, Section } from "./arrange"

/** The list as it was drawn when the pointer came: each section, and its
 * rows by key, in their order. */
export type Held = {
  sections: readonly HeldSection[]
  shelves: readonly HeldSection[]
}

type HeldSection = { section: Section; rows: readonly string[] }

/** A row's key: its Space's and its own. */
export function rowKey(row: Row): string {
  return `${row.space.id}:${row.listed.id}`
}

/** What `arranged` draws now, held as it stands. */
export function held(arranged: Arranged): Held {
  const keep = (section: Section): HeldSection => ({
    section,
    rows: section.rows.map(rowKey),
  })
  return {
    sections: arranged.sections.map(keep),
    shelves: arranged.shelves.map(keep),
  }
}

/**
 * `next`, as `was` drew it: each held row where it was, saying what it
 * says now, and the rows gone left out; and how many rows would come, or
 * come up, as a call does, which wait until the Person takes them in.
 */
export function hold(
  next: Arranged,
  was: Held | undefined
): { arranged: Arranged; updates: number } {
  if (!was) return { arranged: next, updates: 0 }
  const now = new Map<string, Row>()
  const at = new Map<string, { section: string; i: number }>()
  for (const section of [...next.sections, ...next.shelves]) {
    section.rows.forEach((row, i) => {
      now.set(rowKey(row), row)
      at.set(rowKey(row), { section: section.key, i })
    })
  }
  const shown = new Set<string>()
  const draw =
    (fresh: readonly Section[]) =>
    ({ section, rows }: HeldSection): Section => {
      const kept = rows.flatMap((key) => {
        const row = now.get(key)
        if (row) shown.add(key)
        return row ? [row] : []
      })
      const same = fresh.find((one) => one.key === section.key)
      return { ...(same ?? section), rows: kept }
    }
  const sections = was.sections.map(draw(next.sections))
  const shelves = was.shelves.map(draw(next.shelves))
  // What is new, and what would stand higher or in another section.
  let updates = [...now.keys()].filter((key) => !shown.has(key)).length
  for (const section of [...sections, ...shelves]) {
    section.rows.forEach((row, i) => {
      const there = at.get(rowKey(row))
      if (there && (there.section !== section.key || there.i < i)) updates++
    })
  }
  return { arranged: { ...next, sections, shelves }, updates }
}
