/**
 * What a Table of an App's screen shows of its rows: those the Person's
 * words find, in the order of the column they chose, a page at a time.
 * Pure, so it is tested without a page.
 */
import type { TreeAction, TreeColumn, TreeTable } from "@banda/contract/apps"

export type Row = TreeTable["rows"][number]
export type Cell = Row[string] | undefined

/** How many rows a page shows. */
export const PAGE = 50

/** The column the rows are in the order of, and which way. */
export type Order = { key: string; down: boolean }

/** A cell as the words it shows. */
export function wordsOf(cell: Cell): string {
  if (cell === null || cell === undefined) return ""
  return typeof cell === "boolean" ? (cell ? "Yes" : "No") : `${cell}`
}

/** The rows that have `query` in a column's cell, whatever its case. */
export function found(
  rows: readonly Row[],
  columns: readonly TreeColumn[],
  query: string
): readonly Row[] {
  const sought = query.trim().toLowerCase()
  if (sought === "") return rows
  return rows.filter((row) =>
    columns.some((column) =>
      wordsOf(row[column.key]).toLowerCase().includes(sought)
    )
  )
}

const AS_READ = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
})
const none = (cell: Cell) => cell === null || cell === undefined

/** The rows by `order`: numbers by their size, text as it reads, and a
 * row with nothing there last. */
export function ordered(
  rows: readonly Row[],
  order: Order | undefined
): readonly Row[] {
  if (!order) return rows
  return [...rows].sort((a, b) => {
    const [one, other] = [a[order.key], b[order.key]]
    if (none(one) || none(other)) return Number(none(one)) - Number(none(other))
    const way =
      typeof one === "number" && typeof other === "number"
        ? one - other
        : AS_READ.compare(wordsOf(one), wordsOf(other))
    return order.down ? -way : way
  })
}

/** The next order a click on a column's title gives: up, down, then as
 * the App wrote the rows. */
export function nextOrder(
  order: Order | undefined,
  key: string
): Order | undefined {
  if (order?.key !== key) return { key, down: false }
  return order.down ? undefined : { key, down: true }
}

/** What an action does with `row`: `given` is what it writes and what
 * it takes from the row, and `sent` that without what its form fills,
 * which is the form's to send: the row's cell is only what the field
 * starts from. */
export function taken(
  action: TreeAction,
  row: Row
): { sent: Record<string, unknown>; given: Record<string, unknown> } {
  const from = Object.entries(action.take ?? {}).map(([param, key]) => [
    param,
    row[key] ?? null,
  ])
  const given = { ...action.params, ...Object.fromEntries(from) }
  const filled = new Set(action.form?.fields.map((field) => field.name))
  const sent = Object.fromEntries(
    Object.entries(given).filter(([name]) => !filled.has(name))
  )
  return { sent, given }
}
