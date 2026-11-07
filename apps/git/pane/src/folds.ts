/**
 * Which of the Diff's files are folded, and the one chosen in its tree:
 * they open folded, as T3 Code opens them, but for those flipped since,
 * and a file chosen opens and scrolls into view, loaded first when it is
 * not yet.
 */
import { useMemo, useState, type RefObject } from "react"
import {
  keyOf,
  type CodeDiffHandle,
  type FileDiffMetadata,
} from "@banda/ui/components/code-diff"
import type { Files } from "./files"

export function useFolds(
  shown: FileDiffMetadata[],
  files: Files,
  viewer: RefObject<CodeDiffHandle | null>
) {
  const [folds, setFolds] = useState<{
    all: boolean
    flipped: ReadonlySet<string>
  }>({ all: true, flipped: new Set() })
  const folded = useMemo(
    () =>
      new Set(
        shown.map(keyOf).filter((key) => folds.all !== folds.flipped.has(key))
      ),
    [shown, folds]
  )
  const flip = (key: string) =>
    setFolds(({ all, flipped }) => {
      const next = new Set(flipped)
      if (!next.delete(key)) next.add(key)
      return { all, flipped: next }
    })
  const allFolded = shown.length > 0 && folded.size === shown.length
  const foldAll = (all: boolean) => setFolds({ all, flipped: new Set() })

  const [selected, setSelected] = useState<string | null>(null)
  const reveal = (path: string) => {
    setSelected(path)
    const file = files.byPath.get(path)
    if (!file) {
      files.load([path])
      return
    }
    const key = keyOf(file)
    if (folded.has(key)) flip(key)
    // The view scrolls once the file is drawn open.
    requestAnimationFrame(() =>
      viewer.current?.scrollTo({ type: "item", id: key, align: "start" })
    )
  }

  return { folded, flip, allFolded, foldAll, selected, reveal }
}
