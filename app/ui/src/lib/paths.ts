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
