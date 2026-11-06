/**
 * What a view reads of a file as a whole: what the engine answers of it,
 * as an archive's names, or its bytes, all of them, from the file host,
 * as a JSON, a notebook or a font is read. Asked again as the file
 * changes; the last answer stays while the next is asked for, so Quick
 * Look keeps its view under the arrows.
 */
import { useEffect, useRef, useState } from "react"
import { problem } from "@banda/ui/lib/words"
import type { PreviewProps } from "@banda/ui/module"

export type Answer<T> =
  { key: string; answer: T } | { key: string; refused: string }

/** What `ask` answers, asked again as `key` changes: a file's version,
 * and what is asked of it; nothing is asked while it is null. A refusal
 * is said as its words. None before the first answer. */
export function useAnswer<T>(
  key: string | null,
  ask: () => Promise<T>
): Answer<T> | null {
  const [answer, setAnswer] = useState<Answer<T> | null>(null)
  const asking = useRef(ask)
  useEffect(() => {
    asking.current = ask
  })
  useEffect(() => {
    if (key === null) return
    let current = true
    asking.current().then(
      (answer) => current && setAnswer({ key, answer }),
      (error: unknown) => current && setAnswer({ key, refused: problem(error) })
    )
    return () => {
      current = false
    }
  }, [key])
  return answer
}

/** `file`'s bytes, read whole by `read`, with the path they are of; none
 * while it is to be `skipped`, as a file too big to read whole. */
export function useWhole(
  { file, read }: Pick<PreviewProps, "file" | "read">,
  skipped = false
): Answer<{ path: string; bytes: Uint8Array }> | null {
  const { path, modified } = file
  // Read once the host's URL is asked for: `read` says when it has none.
  const ready = file.url !== undefined && !skipped
  return useAnswer(ready ? `${path}\0${modified}` : null, () =>
    read().then((bytes) => ({ path, bytes }))
  )
}
