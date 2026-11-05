import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it } from "vitest"
import { basesOf, findFiles } from "./paths"

let dir: string
let space: string
let worktree: string
let home: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "banda-paths-"))
  space = join(dir, "code", "banda")
  worktree = join(dir, "code", "worktrees", "paths")
  home = join(dir, "home")
  for (const folder of [join(space, "src"), join(worktree, "src"), home])
    await mkdir(folder, { recursive: true })
  await writeFile(join(space, "src", "a.ts"), "")
  await writeFile(join(worktree, "src", "new.ts"), "")
  // A worktree's `.git` is a file.
  await writeFile(join(worktree, ".git"), "gitdir: elsewhere\n")
  await writeFile(join(home, "notes.md"), "")
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

it("a path starts at the Thread's folder, then where its tools worked", async () => {
  const worked = [join(worktree, "src", "new.ts")]
  const found = await findFiles(
    space,
    ["src/a.ts", "src/new.ts", "src/gone.ts", "src", "~/notes.md"],
    worked,
    home
  )
  expect(found).toEqual([
    { file: join(space, "src", "a.ts"), relative: "src/a.ts", inside: true },
    {
      file: join(worktree, "src", "new.ts"),
      relative: "src/new.ts",
      inside: false,
    },
    // Nothing there, and a folder is no file.
    null,
    null,
    {
      file: join(home, "notes.md"),
      relative: join(home, "notes.md"),
      inside: false,
    },
  ])
})

it("a full path is that file, from the Thread's folder if it is in it", async () => {
  const [inside, outside] = await findFiles(
    space,
    [join(space, "src", "a.ts"), join(worktree, "src", "new.ts")],
    [],
    home
  )
  expect(inside).toEqual({
    file: join(space, "src", "a.ts"),
    relative: "src/a.ts",
    inside: true,
  })
  expect(outside?.relative).toBe(join(worktree, "src", "new.ts"))
})

it("the folders tried are the repositories' roots, below home and the root's own folders", async () => {
  const loose = join(dir, "code", "loose")
  await mkdir(loose, { recursive: true })
  expect(
    await basesOf(
      [
        join(worktree, "src", "new.ts"),
        join(worktree, "src", "a.ts"),
        join(loose, "x.ts"),
        "relative/x.ts",
      ],
      home,
      null
    )
  ).toEqual([worktree, loose])
  expect(await basesOf([join(home, "x.ts"), "/tmp/x.ts"], home, null)).toEqual(
    []
  )
})
