/**
 * A folder as `files.tree` holds it: each folder listed as it opens, and
 * the tree's paths made from those listings, or from a filter's matches.
 * A path is from the tree's top folder, with `/` between names; a
 * folder's ends with `/`, and the top is `""`. Pure, so plain tests cover
 * it.
 */
import type { Entry } from "@banda/contract/files"
import { foldersOf } from "@banda/ui/lib/tree-paths"

/** Each folder listed, by its path from the top. */
export type Listed = ReadonlyMap<string, readonly Entry[]>

/** What shows of what is hidden and what git ignores. */
export type Showing = { hidden: boolean; ignored: boolean }

/** Whether an entry opens as a folder: a folder, or a link to one. */
export function isFolder(entry: Entry): boolean {
  return entry.kind === "folder" || entry.to_folder === true
}

/** The entries of a listing that show. */
export function shownOf(entries: readonly Entry[], showing: Showing): Entry[] {
  return entries.filter(
    (entry) =>
      (showing.hidden || !entry.hidden) && (showing.ignored || !entry.ignored)
  )
}

/**
 * The tree's paths from what was listed, in the engine's order: each
 * name of each folder listed and reached from the top; and those git
 * ignores.
 */
export function treeOf(
  listed: Listed,
  showing: Showing
): { paths: string[]; ignored: string[] } {
  const paths: string[] = []
  const ignored: string[] = []
  const visit = (folder: string) => {
    for (const entry of shownOf(listed.get(folder) ?? [], showing)) {
      const path = `${folder}${entry.name}${isFolder(entry) ? "/" : ""}`
      paths.push(path)
      if (entry.ignored) ignored.push(path)
      if (isFolder(entry) && listed.has(path)) visit(path)
    }
  }
  if (listed.has("")) visit("")
  return { paths, ignored }
}

/**
 * The listings with `folder`'s new one: a folder it no longer holds is
 * let go, with all listed under it.
 */
export function merged(
  listed: Listed,
  folder: string,
  entries: readonly Entry[]
): Map<string, readonly Entry[]> {
  const next = new Map(listed)
  next.set(folder, entries)
  const held = new Set(
    entries.filter(isFolder).map((entry) => `${folder}${entry.name}/`)
  )
  for (const path of next.keys()) {
    if (path === folder || !path.startsWith(folder)) continue
    const child = path.slice(0, path.indexOf("/", folder.length) + 1)
    if (!held.has(child)) next.delete(path)
  }
  return next
}

/** The folders open that are to be listed now: each one not listed yet
 * whose folders are, so a deeper one waits for the one above it. */
export function toList(
  open: readonly string[],
  listed: Listed,
  listing: ReadonlySet<string>
): string[] {
  return open.filter(
    (folder) =>
      !listed.has(folder) &&
      !listing.has(folder) &&
      ["", ...foldersOf(folder)].every((above) => listed.has(above))
  )
}

/** The one folder an open folder holds, when it holds nothing else: it
 * shows as one row with it (`a/b`), so it opens with it. */
export function onlyFolder(
  folder: string,
  entries: readonly Entry[],
  showing: Showing
): string | null {
  const shown = shownOf(entries, showing)
  const [only] = shown
  return shown.length === 1 && isFolder(only) ? `${folder}${only.name}/` : null
}

/** A filter's matches as the tree shows them: each file found, under its
 * folders, all open. */
export function matchesOf(found: readonly string[]): {
  paths: string[]
  open: string[]
} {
  const folders = new Set(found.flatMap(foldersOf))
  return {
    paths: [...folders, ...found],
    open: [...folders],
  }
}

/** A new thing's first name in a folder that holds `entries`: `untitled`,
 * or `untitled folder`, then `… 2`, `… 3` as they are taken. */
export function untitled(entries: readonly Entry[], folder: boolean): string {
  const base = folder ? "untitled folder" : "untitled"
  const names = new Set(entries.map((entry) => entry.name))
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} ${n}`)) n += 1
  return `${base} ${n}`
}
