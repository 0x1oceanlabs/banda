/**
 * What the architecture tests read (docs/architecture.md, "Checks that
 * hold the shape"): the source files of a folder, and the modules each
 * one names. For tests alone: it reads the disk.
 */
/// <reference types="node" />
import { readdirSync } from "node:fs"
import { join } from "node:path"

/** Every `.ts` and `.tsx` file under `folder`; without tests when
 * `tests` is false. */
export function sources(
  folder: string,
  { tests = true }: { tests?: boolean } = {}
): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) return sources(path, { tests })
    if (!/\.tsx?$/.test(entry.name)) return []
    return tests || !entry.name.includes(".test.") ? [path] : []
  })
}

/** Every module a file names: `from "…"`, `import "…"`, `import("…")`.
 * A name is on one line, so words in a string, such as `key="forked-from"`,
 * are not taken for one. */
export function imports(source: string): string[] {
  const found = source.matchAll(
    /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"'\n]+)["']/g
  )
  return [...found].map((match) => match[1])
}
