/**
 * Where a widget moved with Alt goes, and the `[bar]` it writes
 * (ADR 0064). Pure, so plain tests cover it.
 */
import { PARTS, type Part } from "./placed"

/** Each part's ids, in order. */
export type Layout = Record<Part, readonly string[]>

/** `layout` with `id` taken out and put in `part` at `index`, counted
 * among that part's other ids. */
export function moved(
  layout: Layout,
  id: string,
  part: Part,
  index: number
): Layout {
  const next = {} as Record<Part, string[]>
  for (const one of PARTS) next[one] = layout[one].filter((x) => x !== id)
  const at = Math.max(0, Math.min(index, next[part].length))
  next[part].splice(at, 0, id)
  return next
}

/** Whether two layouts stand the same. */
export function same(a: Layout, b: Layout): boolean {
  return PARTS.every(
    (part) =>
      a[part].length === b[part].length &&
      a[part].every((id, i) => b[part][i] === id)
  )
}

/**
 * The lists `[bar]` gets once the shown widgets stand as `after`: those,
 * then each id of `bar`'s part the bar did not show, as a module's the
 * engine does not run now, so it keeps its part.
 */
export function written(bar: Layout, shown: Layout, after: Layout): Layout {
  const drawn = new Set(PARTS.flatMap((part) => shown[part]))
  const next = {} as Record<Part, string[]>
  for (const part of PARTS) {
    const kept = bar[part].filter((id) => !drawn.has(id))
    next[part] = [...new Set([...after[part], ...kept])]
  }
  return next
}
