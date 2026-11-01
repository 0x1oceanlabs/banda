/**
 * What a turn changed in files, from the diffs its tool calls carry, not
 * from git, so it holds in any Space (ADR 0010, decision 3). Pure, so plain
 * tests cover it.
 */
import type { Item } from "@banda/contract/agents"
import { counts, type Line, lineDiff } from "./diff"

/** One file's change, line by line: how it was before and after. */
export type FileChange = {
  path: string
  /** Its text before; none when the change made it. */
  old?: string
  new: string
  lines: Line[]
  added: number
  removed: number
}

/** Changes already diffed, by path, newest last. A Thread draws its turns
 * again on every event; their files stay as they were, so their diffs are
 * found here instead of diffed again. */
const DIFFED = new Map<string, FileChange>()
const MOST_DIFFED = 200

/** The change to `path` from `old` to `text`, line by line. */
export function fileChange(
  path: string,
  old: string | undefined,
  text: string
): FileChange {
  const known = DIFFED.get(path)
  if (known && known.old === old && known.new === text) return known
  const lines = lineDiff(old, text)
  const change = { path, old, new: text, lines, ...counts(lines) }
  DIFFED.delete(path)
  DIFFED.set(path, change)
  if (DIFFED.size > MOST_DIFFED) DIFFED.delete(DIFFED.keys().next().value!)
  return change
}

/** The files the tool calls of `turn` changed, each from how it was before
 * the turn's first change to after its last, in the order it first changed
 * them. A file changed back to how it was is left out. */
export function changes(items: Item[], turn: string): FileChange[] {
  const files = new Map<string, { old?: string; new: string }>()
  for (const item of items) {
    if (item.turn !== turn || item.body.kind !== "tool") continue
    if (item.body.status === "failed") continue
    for (const part of item.body.content) {
      if (part.kind !== "diff") continue
      const before = files.get(part.path)
      files.set(part.path, {
        old: before ? before.old : part.old,
        new: part.new,
      })
    }
  }
  return [...files].flatMap(([path, file]) =>
    file.old === file.new ? [] : [fileChange(path, file.old, file.new)]
  )
}

/** Every line the changes added and removed. */
export function total(files: { added: number; removed: number }[]): {
  added: number
  removed: number
} {
  return files.reduce(
    (sum, file) => ({
      added: sum.added + file.added,
      removed: sum.removed + file.removed,
    }),
    { added: 0, removed: 0 }
  )
}
