/**
 * The files of the Diff as its view draws them: from git's patch, loaded
 * a few at a time past a cut one, each read whole to expand, and beside
 * them a turn's files drawn from its tool calls, as they came.
 */
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import type { Engine, ProjectId } from "@banda/contract"
import type { DiffAsk } from "@banda/contract/git"
import {
  filesOf,
  pathOf,
  type FileDiffMetadata,
} from "@banda/ui/components/code-diff"
import { Spinner } from "@banda/ui/components/spinner"
import type { Drawn } from "./read"

/** A short number for a patch, so highlighting kept for one is not used
 * for another. */
function hashOf(text: string): string {
  let hash = 5381
  for (let i = 0; i < text.length; i++)
    hash = (Math.imul(hash, 33) ^ text.charCodeAt(i)) | 0
  return (hash >>> 0).toString(36)
}

/**
 * The files of a diff as the view draws them, by path: those its patch
 * holds and those drawn beside it, and those the patch left out, loaded by
 * name a few at a time as they come into view. A diff read again with the
 * same patch keeps them all, so nothing is drawn again. `whole` reads a
 * file's both sides for its context to expand.
 */
export function useFiles(
  engine: Engine,
  project: ProjectId,
  ask: DiffAsk | null,
  words: string,
  diff: Drawn | undefined
) {
  const patch = diff?.patch ?? ""
  const hashed = useMemo(() => hashOf(patch), [patch])
  const basis = `${words}:${hashed}`
  const drawn = diff?.drawn
  const inPatch = useMemo(
    () => [...filesOf(patch, basis), ...(drawn ?? [])],
    [drawn, patch, basis]
  )
  // What loaded by name belongs to one patch.
  const [loaded, setLoaded] = useState<{
    basis: string
    files: FileDiffMetadata[]
  }>({ basis, files: [] })
  const [loading, setLoading] = useState(false)
  const byPath = useMemo(() => {
    const extra = loaded.basis === basis ? loaded.files : []
    return new Map([...inPatch, ...extra].map((file) => [pathOf(file), file]))
  }, [inPatch, loaded, basis])
  const missing = useMemo(
    () =>
      (diff?.files ?? [])
        .filter((file) => !byPath.has(file.path))
        .map((file) => file.path),
    [diff, byPath]
  )

  const load = (paths: string[]) => {
    if (!ask || loading || paths.length === 0) return
    setLoading(true)
    engine
      .call("git.diff", { ...ask, files: paths }, { project })
      .then((more) => {
        const files = filesOf(more.patch, `${basis}:${paths.join("\0")}`)
        setLoaded((was) => ({
          basis,
          files: [...(was.basis === basis ? was.files : []), ...files],
        }))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  // A turn's files come whole; git's are read whole to expand.
  const whole = useMemo(
    () =>
      ask &&
      (async (file: FileDiffMetadata) => {
        const contents = await engine.call(
          "git.contents",
          {
            scope: ask.scope,
            path: pathOf(file),
            ...(file.prevName ? { old_path: file.prevName } : {}),
          },
          { project }
        )
        if (contents.too_large)
          throw new Error("The file is too large to expand.")
        return {
          oldFile: {
            name: file.prevName ?? pathOf(file),
            contents: contents.old ?? "",
          },
          newFile: { name: pathOf(file), contents: contents.new ?? "" },
        }
      }),
    [engine, project, ask]
  )

  return { byPath, missing, loading, load, whole }
}

/** A diff's files as {@link useFiles} has them. */
export type Files = ReturnType<typeof useFiles>

/** The end of the files drawn, while more wait: they load as it shows. */
export function More({
  left,
  loading,
  onSeen,
}: {
  left: number
  loading: boolean
  onSeen: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const seen = useEffectEvent(onSeen)
  useEffect(() => {
    const element = box.current
    if (!element) return
    const watch = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) seen()
      },
      { rootMargin: "600px" }
    )
    watch.observe(element)
    return () => watch.disconnect()
  }, [])
  return (
    <div
      ref={box}
      className="flex h-12 items-center justify-center gap-2 text-xs text-muted-foreground"
    >
      {loading && <Spinner className="size-3" />}
      {left === 1 ? "1 more file" : `${left} more files`}
    </div>
  )
}
