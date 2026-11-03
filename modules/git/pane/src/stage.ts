/**
 * What the Diff can do to what it shows, as the Codex app's review pane
 * does (ADR 0034, decision 2): Unstaged stages and reverts, Staged
 * unstages, a hunk, a file or all of it at a time. Pure, so plain tests
 * cover it.
 */
import type { ChangeAsk, FileDiff } from "@banda/contract/git"
import { pathOf, type FileDiffMetadata } from "@banda/ui/components/code-diff"
import type { Scope } from "./scope"

export type Act = "stage" | "unstage" | "revert"

/** What a scope's changes can have done to them; the rest only show. */
export function actsOf(scope: Scope): Act[] {
  switch (scope.kind) {
    case "unstaged":
      return ["stage", "revert"]
    case "staged":
      return ["unstage"]
    default:
      return []
  }
}

/** A file's paths, where it is and where it was before a rename. */
function pathsOf(path: string, old: string | undefined | null): string[] {
  return old && old !== path ? [path, old] : [path]
}

/** All the files of a diff, whole. */
export function allOf(files: readonly FileDiff[]): ChangeAsk {
  return { files: files.flatMap((file) => pathsOf(file.path, file.old_path)) }
}

/** One file, whole. */
export function fileAsk(file: FileDiffMetadata): ChangeAsk {
  return { files: pathsOf(pathOf(file), file.prevName) }
}

/** The lines of one hunk of a file: the file whole when its hunk is all
 * of it, as a new or a removed file's is; none when the patch names no
 * objects to check the file by, and only the file can be changed. */
export function hunkAsk(
  file: FileDiffMetadata,
  index: number
): ChangeAsk | null {
  const hunk = file.hunks[index]
  if (file.type === "new" || file.type === "deleted") return fileAsk(file)
  if (!hunk || !file.prevObjectId || !file.newObjectId) return null
  return {
    ...fileAsk(file),
    hunk: {
      old_start: hunk.deletionStart,
      old_lines: hunk.deletionCount,
      new_start: hunk.additionStart,
      new_lines: hunk.additionCount,
      old_id: file.prevObjectId,
      new_id: file.newObjectId,
    },
  }
}
