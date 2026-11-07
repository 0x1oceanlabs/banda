/**
 * Which widgets the bar draws in each of its parts, as the look's `[bar]`
 * lists them (ADR 0024, decision 4), and the ids it has no widget for.
 * Pure, so plain tests cover it.
 */
import type { Bar, Problem, Setting } from "@banda/contract/look"

export const PARTS = ["left", "center", "right"] as const

/** The workspaces, a widget the window always has (ADR 0064, decision 2). */
export const WORKSPACES = "workspaces.list"
export type Part = (typeof PARTS)[number]

/** What the window knows of an id: a widget it draws, one whose module the
 * engine does not run now, or none. */
export type Known = "shown" | "off" | undefined

/**
 * Each part's ids the bar draws, in order and each once, and a Problem at
 * the file's line for each id no module has, as `keys.toml`'s are. An id
 * whose module does not run is left out, and is no Problem. The
 * workspaces stand first on the left when no part lists them.
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
      const is = id === WORKSPACES ? "shown" : known(id)
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
  if (!drawn.has(WORKSPACES)) parts.left.unshift(WORKSPACES)
  return { parts, problems }
}
