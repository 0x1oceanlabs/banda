/**
 * Where a link the terminal found in what a program printed goes: a page
 * as it is, a file by its full path. A file's line and column, as in
 * `src/main.rs:12:5`, are left off: no page goes to a line. Pure, so plain
 * tests cover it.
 */
import type { Title } from "@banda/contract/terminal"

/** A web page, or a file by its full path. */
export type Target = { page: string } | { file: string }

/**
 * Where `text` goes. A path that does not start at `/` starts in the
 * folder of what runs in front, `at`, and `~` is the home folder; with no
 * `at`, only a full path goes anywhere. None for a Windows path either.
 */
export function targetOf(text: string, at?: Title): Target | null {
  if (/^https?:\/\//i.test(text)) return { page: text }
  const path = text.replace(/(:\d+){1,2}$/, "")
  if (path.startsWith("/")) return { file: tidy(path) }
  if (!at || /^[A-Za-z]:[\\/]|^\\\\/.test(path)) return null
  if (path === "~" || path.startsWith("~/")) {
    return at.home === null ? null : { file: tidy(at.home + path.slice(1)) }
  }
  return { file: tidy(`${at.path}/${path}`) }
}

/** A full path with no `.`, `..` or empty steps. */
function tidy(path: string): string {
  const steps: string[] = []
  for (const step of path.split("/")) {
    if (step === "..") steps.pop()
    else if (step && step !== ".") steps.push(step)
  }
  return `/${steps.join("/")}`
}
