#!/usr/bin/env node
/**
 * Renames Tailwind's names to Banda UI's in Banda's code (ADR 0113,
 * decision 8): `text-xs` to `text-meta`, `text-sm` to `text-ui` (step
 * 1b). Each pair is the same level under two names, so nothing on screen
 * changes.
 *
 * It reads what the look check reads, the files that draw (`drawingFiles`),
 * and the tests beside them, which assert the classes those files render;
 * not `utils.test.ts`, which tests Tailwind's names themselves.
 *
 * A class is renamed in every form it takes: alone, after variants
 * (`md:`, `[&_svg]:`, `group-data-[size=xs]/item:`), with a line height
 * (`text-sm/6`) or `!`, in a string, a `cn()`, a `cva` or a template. A
 * word that only holds the name (`context-sm`, `--text-sm`, `.text-sm`) is
 * not. Prettier then formats what it changed, as a longer name may wrap a
 * line. It is idempotent: a branch opened before the rename runs it again
 * after its rebase, and only what the branch added changes.
 *
 * Where a renamed class shares a string with another level under the same
 * variants, it says so: unless `cn()` merges them, the CSS's order picks
 * one, and the new name sorts elsewhere than the old.
 *
 *   node scripts/look-names.mjs           # rename, and say what changed
 *   node scripts/look-names.mjs --check   # say what is left, change nothing
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { drawingFiles } from "../client/ui/src/testing/architecture.ts"

/** A class starts after a space, a quote, a bracket or a variant's colon,
 * never inside a word, a custom property or a selector; it ends before
 * anything but a word's character or a `-`, so `/6` and `!` stay on it.
 * Each with Banda UI's name for the same level. */
const RENAMES = [
  ["text-xs", "text-meta"],
  ["text-sm", "text-ui"],
].map(([from, to]) => [
  new RegExp(`(?<![\\w./\\[-])${from}(?![\\w-])`, "g"),
  to,
])

const root = join(import.meta.dirname, "..")
const check = process.argv.includes("--check")

/** The tests that hold Tailwind's names on purpose. */
const KEEP = new Set(["client/ui/src/lib/utils.test.ts"])

/** The type scale's levels, as `@theme` makes them: a level is its own
 * size's token (`--text-meta: var(--meta-size)`). */
const LEVELS = [
  ...readFileSync(
    join(root, "client/ui/src/styles/globals.css"),
    "utf8"
  ).matchAll(/--text-([\w-]+):\s*var\(--\1-size\)/g),
].map(([, level]) => level)
const SIZE = new RegExp(`^(.*:)?!?text-(${LEVELS.join("|")})(/\\S+)?!?$`)
const RENAMED = new Set(RENAMES.map(([, to]) => to.slice("text-".length)))

/** The strings in `text` with a renamed class and another level under the
 * same variants. */
function twoSizes(text) {
  return [...text.matchAll(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g)].flatMap(
    ([string]) => {
      const by = Map.groupBy(
        string
          .split(/[\s"'`]+/)
          .map((word) => SIZE.exec(word))
          .filter(Boolean),
        ([, variants = ""]) => variants
      )
      return [...by.values()].some(
        (sizes) =>
          sizes.length > 1 && sizes.some(([, , level]) => RENAMED.has(level))
      )
        ? [string]
        : []
    }
  )
}

const changed = drawingFiles(root, { tests: true }).flatMap((file) => {
  if (KEEP.has(relative(root, file))) return []
  const before = readFileSync(file, "utf8")
  let count = 0
  const after = RENAMES.reduce(
    (text, [from, to]) =>
      text.replace(from, () => {
        count++
        return to
      }),
    before
  )
  if (count > 0 && !check) writeFileSync(file, after)
  return count > 0 ? [{ file, count, twins: twoSizes(after) }] : []
})

if (changed.length > 0 && !check)
  execFileSync(
    join(root, "node_modules/.bin/prettier"),
    ["--write", "--log-level", "warn", ...changed.map(({ file }) => file)],
    { cwd: root, stdio: "inherit" }
  )

for (const { file, count, twins } of changed) {
  console.log(`${relative(root, file)}: ${count}`)
  for (const string of twins)
    console.log(`  two sizes in one string, see which shows: ${string}`)
}
const total = changed.reduce((sum, { count }) => sum + count, 0)
console.log(
  `${check ? "left" : "renamed"}: ${total} in ${changed.length} files (text-xs → text-meta, text-sm → text-ui)`
)
if (check && total > 0) process.exitCode = 1
