/** Helpers for main's unit tests (`*.test.ts`). */
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** A shell script in a folder of its own; returns its path. */
export function script(text: string): string {
  const program = join(mkdtempSync(join(tmpdir(), "banda-test-")), "program")
  writeFileSync(program, `#!/bin/sh\n${text}\n`, { mode: 0o755 })
  return program
}
