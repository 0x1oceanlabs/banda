/**
 * Which widgets the bar draws in each of its parts, as the look's `[bar]`
 * lists them (ADR 0024, decision 4), and the ids it has no widget for.
 * Pure, so plain tests cover it.
 */
import type { Bar, Problem, Setting } from "@banda/contract/look"
import { WORKSPACES } from "../../tiling/widget-ids"
import { CONNECTION, PROBLEMS, UPDATE } from "../widget-ids"

export const PARTS = ["left", "center", "right"] as const

export type Part = (typeof PARTS)[number]

/**
 * The window's widgets that always stand on the bar, and where one no part
 * lists goes: the Pager first on the left (ADR 0064, decision 2); the
 * update, the look's problems and the engine's connection last on the
 * right, so a Person's own `right` never hides them. Each shows only while
 * it has something to say.
 */
const ALWAYS: readonly { id: string; part: Part; first?: true }[] = [
  { id: WORKSPACES, part: "left", first: true },
  { id: UPDATE, part: "right" },
  { id: PROBLEMS, part: "right" },
  { id: CONNECTION, part: "right" },
]

/** What the window knows of an id: a widget it draws, one whose module the
 * engine does not run now, or none. */
export type Known = "shown" | "off" | undefined

/**
 * Each part's ids the bar draws, in order and each once, and a Problem at
 * the file's line for each id no module has, as `keys.toml`'s are. An id
 * whose module does not run is left out, and is no Problem. The window's
 * own that always stand on it (`ALWAYS`) go where it says when no part
 * lists them.
 */
export function placed(
  bar: Bar,
  known: (id: string) => Known,
  /** Each key of `look.toml`, and where it comes from. */
  keyed: Readonly<Record<string, Setting>> = {}
): { parts: Record<Part, string[]>; problems: Problem[] } {
  const problems: Problem[] = []
  const drawn = new Set<string>()
  const parts = {} as Record<Part, string[]>
  for (const part of PARTS) {
    parts[part] = []
    for (const id of bar[part]) {
      const is = ALWAYS.some((one) => one.id === id) ? "shown" : known(id)
      if (is === undefined) {
        const key = `bar.${part}`
        const from = keyed[key]?.from
        problems.push({
          path: from?.path ?? "look.toml",
          ...(from?.line !== undefined && { line: from.line }),
          key,
          message: `${key} names "${id}", and no module has that widget`,
        })
      } else if (is === "shown" && !drawn.has(id)) {
        drawn.add(id)
        parts[part].push(id)
      }
    }
  }
  for (const { id, part, first } of ALWAYS)
    if (!drawn.has(id)) {
      if (first) parts[part].unshift(id)
      else parts[part].push(id)
    }
  return { parts, problems }
}
