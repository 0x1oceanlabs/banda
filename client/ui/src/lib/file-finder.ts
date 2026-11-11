/**
 * Finds the files paths name, one path at a time for whoever draws it,
 * the paths asked for together sent in one call (ADR 0063, decision 2):
 * all of a reply's at once.
 */
import type { Located } from "@banda/contract/files"

/** How long a path with no file there is taken at its word. */
const AGAIN = 10_000

/** At most this many paths go in one call: `files.locate` looks at no
 * more, and a path past them would come back as naming no file. */
const BATCH = 200

/** `find` for one path, each file matched to its path by `asked`, as the
 * answer holds only the paths that name one; a file found is kept, a path
 * with none is asked about again after a while. */
export function finder(
  find: (paths: string[]) => Promise<Located[]>
): (path: string) => Promise<Located | null> {
  const known = new Map<string, Promise<Located | null>>()
  let waiting: Array<{
    path: string
    settle: (file: Located | null) => void
  }> = []
  const send = () => {
    const paths = waiting
    waiting = []
    for (let from = 0; from < paths.length; from += BATCH) {
      const batch = paths.slice(from, from + BATCH)
      find(batch.map((one) => one.path)).then(
        (files) => {
          const named = new Map(files.map((file) => [file.asked, file]))
          batch.forEach((one) => one.settle(named.get(one.path) ?? null))
        },
        () => batch.forEach((one) => one.settle(null))
      )
    }
  }
  return (path) => {
    const was = known.get(path)
    if (was) return was
    const file = new Promise<Located | null>((settle) => {
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
