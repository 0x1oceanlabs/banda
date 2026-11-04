import type { Ref } from "@banda/contract/git"
import { expect, test } from "vitest"
import { branchName, finds, listedOf, taken } from "./branches"

const ref = (name: string, more: Partial<Ref> = {}): Ref => ({
  name,
  remote: false,
  current: false,
  default: false,
  ...more,
})

test("Create branch makes a name of the words, as T3 Code's", () => {
  expect(branchName("  My Fix ")).toBe("my-fix")
  expect(branchName("fix: the  card's look!")).toBe("fix-the-cards-look")
  expect(branchName("feature//Big.Thing")).toBe("feature/big-thing")
  expect(branchName("-/-")).toBe("")
  expect(branchName("a".repeat(80))).toHaveLength(64)
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
  expect(finds(ref("other"), "oth")).toBe(true)
  expect(finds(ref("my-fix"), "My fix")).toBe(true)
  expect(finds(ref("main"), "oth")).toBe(false)
})

test("a name a remote's branch has is taken too", () => {
  const refs = [ref("main"), ref("origin/feature/x", { remote: true })]
  expect(taken(refs, "main")).toBe(true)
  expect(taken(refs, "feature/x")).toBe(true)
  expect(taken(refs, "feature")).toBe(false)
})
