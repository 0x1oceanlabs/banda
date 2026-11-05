/**
 * The line a reply's code block offers to run (ADR 0063, decision 6): a
 * block of one line in a shell's language, its `$ ` prompt taken off.
 */
import { ALIASES } from "./languages"

/** A shell's script, as `bash` or `zsh`, and a session, as `console`. */
const SHELLS = new Set(["shellscript", "shellsession"])

/** The line `code` in `language` would run; none for another language or
 * more than one line. */
export function shellLine(language: string, code: string): string | null {
  if (!SHELLS.has(ALIASES.get(language.toLowerCase()) ?? "")) return null
  const line = code.trim()
  if (line.includes("\n")) return null
  return line.replace(/^\$(\s+|$)/, "").trim() || null
}
