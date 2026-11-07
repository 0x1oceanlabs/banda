/**
 * Files' own clipboard of paths (ADR 0073, decision 10): Ctrl+C and
 * Ctrl+X on rows keep their whole paths here, for Ctrl+V to copy or move
 * into another folder, and put them on the system's clipboard as text, a
 * line each, for anything else. One for the window.
 */
import { copyText } from "@banda/ui/lib/clipboard"

export type Clip = { paths: readonly string[]; cut: boolean }

let clip: Clip | null = null

/** Keeps `paths` to paste, cut or copied. */
export function keep(paths: readonly string[], cut: boolean): void {
  clip = { paths, cut }
  copyText(paths.join("\n"))
}

/** What waits to be pasted. */
export function kept(): Clip | null {
  return clip
}

/** Lets go of what was cut, once it moved. */
export function pasted(was: Clip): void {
  if (was.cut && clip === was) clip = null
}
