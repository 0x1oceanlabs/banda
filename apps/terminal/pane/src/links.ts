/**
 * Where a link the terminal found in what a program printed goes: a page
 * as it is, a file by its full path, at its line, as in
 * `src/main.rs:12:5`; Files opens it there (ADR 0073). Pure, so plain
 * tests cover it.
 */
import type { Title } from "@banda/contract/terminal"
import { type Link, linkOf } from "@banda/core/react"
import { named } from "@banda/ui/lib/file-links"

/** A web page, by the `Link` that says whose it is (ADR 0106, law 2), or
 * a file by its full path and perhaps its line. */
export type Target = { link: Link } | { file: string; line?: number }

/**
 * Where `text` goes. A path that does not start at `/` starts in the
 * folder of what runs in front, `at`, and `~` is the home folder; with no
 * `at`, only a full path goes anywhere. None for a Windows path either.
 */
export function targetOf(text: string, at?: Title): Target | null {
  const link = linkOf(text)
  if (link) return { link }
  const { path, line } = named(text)
  const file = (full: string) => ({
    file: tidy(full),
    ...(line !== undefined && { line }),
  })
  if (path.startsWith("/")) return file(path)
  if (!at || /^[A-Za-z]:[\\/]|^\\\\/.test(path)) return null
  if (path === "~" || path.startsWith("~/")) {
    return at.home === null ? null : file(at.home + path.slice(1))
  }
  return file(`${at.path}/${path}`)
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

/** Where a click with Ctrl takes `target`, in words. */
export function outsideOf(target: Target): string {
  return "link" in target ? "in external browser" : "in its app"
}
