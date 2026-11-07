/**
 * Bulk rename as text (ADR 0073, decision 10; the research's §3): the
 * names of the rows picked, one a line, edited as text; what changed is
 * read back, checked, and shown as a diff before it runs. A name may take
 * another's that is renamed away, even in a ring (`a` → `b` → `a`): the
 * order goes where each name is free, through a name of its own when it
 * must, and what a folder holds before the folder. Pure, so plain tests
 * cover it.
 */
import { nameOf, parentOf } from "./where"

/** A row to rename: its whole path. */
export type Named = { path: string }

/** One rename: its whole path, and its new name in its folder. */
export type Renaming = { path: string; name: string }

/** The rows' names, one a line. */
export function namesText(rows: readonly Named[]): string {
  return rows.map((row) => nameOf(row.path)).join("\n")
}

/** The folder a whole path is in. */
const folderOf = (path: string) => parentOf(path) ?? "/"

/**
 * The renames `text` asks of `rows`, one name a line in their order; or
 * why not. `taken` names what each folder holds now, besides the rows: a
 * new name may not be one of those, nor another row's new name, nor
 * empty, nor hold a `/`.
 */
export function readNames(
  text: string,
  rows: readonly Named[],
  taken: (folder: string) => ReadonlySet<string>
): { renames: Renaming[] } | { problem: string } {
  const lines = text.replace(/\n$/, "").split("\n")
  if (lines.length !== rows.length)
    return {
      problem: `${rows.length} names are renamed, one a line: ${lines.length} ${lines.length === 1 ? "line is" : "lines are"} there.`,
    }
  const renames: Renaming[] = []
  const goingTo = new Map<string, Set<string>>()
  const leaving = new Map<string, Set<string>>()
  for (const row of rows) {
    const folder = folderOf(row.path)
    if (!leaving.has(folder)) leaving.set(folder, new Set())
    leaving.get(folder)?.add(nameOf(row.path))
  }
  for (const [n, row] of rows.entries()) {
    const name = lines[n].trim()
    const folder = folderOf(row.path)
    const line = `Line ${n + 1}`
    if (!name) return { problem: `${line} is empty: a name cannot be.` }
    if (name.includes("/")) return { problem: `${line}: a name holds no /.` }
    if (name === "." || name === "..")
      return { problem: `${line}: a name cannot be ${name}.` }
    const going = goingTo.get(folder) ?? new Set()
    if (going.has(name))
      return { problem: `${line}: “${name}” is given twice in one folder.` }
    going.add(name)
    goingTo.set(folder, going)
    if (name === nameOf(row.path)) continue
    const held = taken(folder)
    if (held.has(name) && !leaving.get(folder)?.has(name))
      return { problem: `${line}: “${name}” is already in its folder.` }
    renames.push({ path: row.path, name })
  }
  return { renames }
}

/**
 * The renames in an order that never names a thing over another: each
 * whose new name is free goes first; a ring of names goes through a name
 * no one has, `.name.banda-rename`, and back.
 */
export function inOrder(renames: readonly Renaming[]): Renaming[] {
  // By whole path: where each now is, and where it goes; what a folder
  // holds before the folder, whose path it changes.
  const depth = (one: Renaming) => one.path.split("/").length
  const pending = new Map(
    renames
      .toSorted((a, b) => depth(b) - depth(a))
      .map((one) => [one.path, `${folderOf(one.path)}/${one.name}`])
  )
  const steps: Renaming[] = []
  const go = (from: string, to: string) => {
    steps.push({ path: from, name: nameOf(to) })
    pending.delete(from)
  }
  while (pending.size > 0) {
    const free = [...pending].find(([, to]) => !pending.has(to))
    if (free) {
      go(free[0], free[1])
      continue
    }
    // Every one left waits on another: a ring. One steps aside first.
    const [from, to] = pending.entries().next().value as [string, string]
    const aside = `${folderOf(from)}/.${nameOf(from)}.banda-rename`
    steps.push({ path: from, name: nameOf(aside) })
    pending.delete(from)
    pending.set(aside, to)
  }
  return steps
}
