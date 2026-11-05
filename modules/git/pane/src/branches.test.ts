import type { Ref } from "@banda/contract/git"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "vitest"
import { branchName, finds, listedOf, taken } from "./branches"

const ref = (name: string, more: Partial<Ref> = {}): Ref => ({
  name,
  remote: false,
  current: false,
  default: false,
  ...more,
})

test("Create branch makes a name of the words as the engine names a branch", () => {
  const cases = JSON.parse(
    readFileSync(join(import.meta.dirname, "../../branch-names.json"), "utf8")
  ) as { words: string; name: string }[]
  for (const { words, name } of cases) expect(branchName(words)).toBe(name)
})

test("a remote's branch is left out when one here has its name", () => {
  const refs = [
    ref("main", { default: true }),
    ref("origin/main", { remote: true, default: true }),
    ref("origin/other", { remote: true }),
  ]
  expect(listedOf(refs).map((each) => each.name)).toEqual([
    "main",
    "origin/other",
  ])
})

test("a search finds by the words and by the name they make", () => {
  expect(finds(ref("other"), "oth", "oth")).toBe(true)
  expect(finds(ref("my-fix"), "My fix", "my-fix")).toBe(true)
  expect(finds(ref("main"), "oth", "oth")).toBe(false)
})

test("a name a remote's branch has is taken too", () => {
  const refs = [ref("main"), ref("origin/feature/x", { remote: true })]
  expect(taken(refs, "main")).toBe(true)
  expect(taken(refs, "feature/x")).toBe(true)
  expect(taken(refs, "feature/y")).toBe(false)
  // A folder of a name, and a name of a folder, are in each other's way.
  expect(taken(refs, "feature")).toBe(true)
  expect(taken(refs, "main/x")).toBe(true)
})
