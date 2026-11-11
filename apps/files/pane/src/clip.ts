/**
 * Files' own clipboard of paths (ADR 0073, decision 10): Ctrl+C and
 * Ctrl+X on rows keep their files here, each with its Project (ADR 0106,
 * decision 5), for Ctrl+V to copy or move into another folder of the same
 * machine, and put their whole paths on the system's clipboard as text, a
 * line each, for anything else. One for the window.
 */
import type { ProjectFile } from "@banda/core/react"
import { copyText } from "@banda/ui/lib/clipboard"

export type Clip = { files: readonly ProjectFile[]; cut: boolean }

let clip: Clip | null = null

/** Keeps `files` to paste, cut or copied. */
export function keep(files: readonly ProjectFile[], cut: boolean): void {
  clip = { files, cut }
  copyText(files.map((file) => file.path).join("\n"))
}

/** What waits to be pasted. */
export function kept(): Clip | null {
  return clip
}

/** Lets go of what was cut, once it moved. */
export function pasted(was: Clip): void {
  if (was.cut && clip === was) clip = null
}
