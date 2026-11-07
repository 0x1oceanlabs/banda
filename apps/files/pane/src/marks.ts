/**
 * git's marks on a Files tree (ADR 0073, decision 3), from the git
 * module's `git.watch`: M on what changed, A on what is new, untracked
 * too, and a dot on the folders that hold them. A folder shows them only when it is in the
 * Project's repository. Pure, so plain tests cover it.
 */
import type { Mark } from "@banda/ui/components/file-tree"
import { within } from "./where"

/** A file as `git.watch` says it changed: from the repository's top. */
export type Changed = { path: string; status: string }

const MARKS: Readonly<Record<string, Mark>> = {
  modified: "modified",
  conflicted: "modified",
  renamed: "renamed",
  added: "added",
  untracked: "added",
  deleted: "deleted",
}

/**
 * The marks on the tree of folder `dir`, by its paths: each file changed
 * under it. git names them from the repository's top, which is taken to
 * be the Project's folder `top`, as the Diff takes it.
 */
export function marksOf(
  files: readonly Changed[],
  top: string,
  dir: string
): Map<string, Mark> {
  const marks = new Map<string, Mark>()
  for (const file of files) {
    const mark = MARKS[file.status]
    const path = within(dir, `${top.replace(/\/$/, "")}/${file.path}`)
    if (mark && path) marks.set(path, mark)
  }
  return marks
}
