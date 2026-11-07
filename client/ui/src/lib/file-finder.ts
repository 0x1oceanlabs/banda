/**
 * Finds the files paths name, one path at a time for whoever draws it,
 * the paths asked for together sent in one call (ADR 0063, decision 2):
 * all of a reply's at once.
 */
import type { FoundFile } from "@banda/contract/agents"

/** How long a path with no file there is taken at its word. */
const AGAIN = 10_000

/** `find` for one path; a file found is kept, a path with none is asked
 * about again after a while. */
export function finder(
  find: (paths: string[]) => Promise<Array<FoundFile | null>>
): (path: string) => Promise<FoundFile | null> {
  const known = new Map<string, Promise<FoundFile | null>>()
  let waiting: Array<{
    path: string
    settle: (file: FoundFile | null) => void
  }> = []
  const send = () => {
    const batch = waiting
    waiting = []
    find(batch.map((one) => one.path)).then(
      (files) => batch.forEach((one, n) => one.settle(files[n] ?? null)),
      () => batch.forEach((one) => one.settle(null))
    )
  }
  return (path) => {
    const was = known.get(path)
    if (was) return was
    const file = new Promise<FoundFile | null>((settle) => {
      if (waiting.length === 0) setTimeout(send)
      waiting.push({ path, settle })
    })
    known.set(path, file)
    void file.then((found) => {
      if (!found) setTimeout(() => known.delete(path), AGAIN)
    })
    return file
  }
}
