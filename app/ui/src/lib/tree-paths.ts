/**
 * A tree's paths as `@pierre/trees` holds them: from the tree's top, `/`
 * between names, a folder's ending with `/`. Pure, so plain tests cover
 * it.
 */

/** One change to a tree's paths, as `@pierre/trees`' `batch` takes it. */
export type PathUpdate =
  | { type: "add"; path: string }
  | { type: "remove"; path: string; recursive?: true }

/** How deep `path` is: how many names it has. */
function depth(path: string): number {
  return path.split("/").filter(Boolean).length
}

/**
 * What turns the paths `was` into `now`: each path gone removed, a folder
 * with what it holds, then each new one added, the shallow first, so a
 * folder comes before what it holds.
 */
export function pathUpdates(
  was: readonly string[],
  now: readonly string[]
): PathUpdate[] {
  const before = new Set(was)
  const after = new Set(now)
  const updates: PathUpdate[] = []
  const gone: string[] = []
  const byDepth = (a: string, b: string) => depth(a) - depth(b)
  for (const path of was.filter((one) => !after.has(one)).sort(byDepth)) {
    if (gone.some((folder) => path.startsWith(folder))) continue
    if (path.endsWith("/")) {
      gone.push(path)
      updates.push({ type: "remove", path, recursive: true })
    } else updates.push({ type: "remove", path })
  }
  for (const path of now.filter((one) => !before.has(one)).sort(byDepth))
    updates.push({ type: "add", path })
  return updates
}

/** The folders `path` is in, from the top: `a/`, then `a/b/`. */
export function foldersOf(path: string): string[] {
  const names = path.split("/").filter(Boolean)
  return names.slice(0, -1).map((_, n) => `${names.slice(0, n + 1).join("/")}/`)
}

/** What a drag of `paths` carries: each one once, and none a folder of
 * them holds, in their order. */
export function outermost(paths: readonly string[]): string[] {
  const folders = paths.filter((path) => path.endsWith("/"))
  return [...new Set(paths)].filter(
    (path) =>
      !folders.some((folder) => folder !== path && path.startsWith(folder))
  )
}
