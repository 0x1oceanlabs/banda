/** A file's path as a list shows it: its name, then the folder it is in,
 * if any. */
export function nameAndFolder(path: string): {
  name: string
  folder?: string
} {
  const slash = path.lastIndexOf("/")
  return {
    name: path.slice(slash + 1),
    folder: slash > 0 ? path.slice(0, slash) : undefined,
  }
}

/** The whole `path` as a message names a file, as `@` does: from
 * `folder` when it is inside it, else whole. */
export function fromFolder(
  path: string,
  folder: string | null | undefined
): string {
  if (!folder) return path
  const base = folder.endsWith("/") ? folder : `${folder}/`
  return path.startsWith(base) && path.length > base.length
    ? path.slice(base.length)
    : path
}

/** Lines of a file as an Agent and a compiler read them: `src/a.ts:12`,
 * or `src/a.ts:12-20`, whichever way they were picked. */
export function atLines(path: string, from: number, to: number): string {
  const [first, last] = [Math.min(from, to), Math.max(from, to)]
  return first === last ? `${path}:${first}` : `${path}:${first}-${last}`
}
