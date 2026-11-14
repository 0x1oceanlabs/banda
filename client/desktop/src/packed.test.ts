import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { ownCopy, PROGRAM, Program } from "./program"

/**
 * The window's copy of the engine, made of what an app was really packed
 * with: `scripts/package.sh` runs this on each system it packs for, so an
 * app whose window cannot make or check its copy is never released (Banda
 * Dev 0.1.0-dev.792 did not start on macOS so). The other tests make their
 * own `banda`; a checkout's window makes no copy at all.
 *
 * `BANDA_PACKED` is the packed app's `resources`; `BANDA_PACKED_BUNDLE`,
 * the engine's bundle packed with it (`scripts/engine.mjs`), where there
 * is one. Without `BANDA_PACKED` there is nothing packed to try.
 */
const resources = process.env.BANDA_PACKED
const bundle = process.env.BANDA_PACKED_BUNDLE

/** What the bundle carries that the window's copy does not need: the
 * licenses the app carries itself, and the Node the adapters run on with
 * no Electron beside them. */
const BUNDLE_ONLY = /^(LICENSE|NOTICE|THIRD-PARTY-NOTICES\.txt|node\/.*)$/

/** A fresh folder, by its real path: macOS's tmpdir is a link. */
const folder = (name: string) =>
  realpathSync(mkdtempSync(join(tmpdir(), `banda-${name}-`)))

/** Each file under `root`, by its path in it, with `/` between. */
function filesIn(root: string, under = root): string[] {
  return readdirSync(under, { withFileTypes: true }).flatMap((entry) => {
    const path = join(under, entry.name)
    if (entry.isDirectory()) return filesIn(root, path)
    return [relative(root, path).split("\\").join("/")]
  })
}

describe.skipIf(!resources)(
  "the window's copy of a packed app's engine",
  () => {
    const program = join(resources ?? "", PROGRAM)

    it.live(
      "is made, checked as whole, and used again at the next start",
      () =>
        Effect.gen(function* () {
          const copies = join(folder("packed"), "engine")
          const copy = yield* ownCopy(program, copies)
          expect(statSync(copy).size).toBe(statSync(program).size)
          // The next start, and each look at it while the window runs.
          expect(yield* ownCopy(program, copies)).toBe(copy)
          const uncopied: string[] = []
          const path = yield* Program.use((own) => own.path).pipe(
            Effect.provide(
              Program.layer({ program, copies }, (why) => uncopied.push(why))
            )
          )
          expect(uncopied).toEqual([])
          expect(path).toBe(copy)
        }).pipe(Effect.provide(NodeServices.layer)),
      60_000
    )

    it.live.skipIf(!bundle)(
      "carries what the engine's bundle carries beside banda",
      () =>
        Effect.gen(function* () {
          const copies = join(folder("packed"), "engine")
          const copy = yield* ownCopy(program, copies)
          const unpacked = folder("bundle")
          execFileSync("tar", ["-xzf", bundle ?? "", "-C", unpacked])
          const carried = filesIn(unpacked).filter(
            (file) => !BUNDLE_ONLY.test(file)
          )
          expect(carried).toContain(PROGRAM)
          const differs = carried.filter((file) => {
            const kept = join(dirname(copy), file)
            return (
              !existsSync(kept) ||
              statSync(kept).size !== statSync(join(unpacked, file)).size
            )
          })
          // A file here is one `scripts/engine.mjs` packs and `program.ts`'s
          // `BESIDE` does not copy: an engine the window started would lack
          // what one that updated itself has.
          expect(differs).toEqual([])
        }).pipe(Effect.provide(NodeServices.layer)),
      60_000
    )
  }
)
