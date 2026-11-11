import type { Located } from "@banda/contract/files"
import { expect, test } from "vitest"
import { finder } from "./file-finder"

const located = (asked: string): Located => ({
  asked,
  file: `/w/${asked}`,
  relative: asked,
  inside: true,
})

test("each path takes its own file by what it asked, as the answer holds only those that name one, in any order", async () => {
  const find = finder(async ([a, , c]) => [located(c!), located(a!)])
  const [first, second, third] = await Promise.all([
    find("a.ts"),
    find("gone.ts"),
    find("c.ts"),
  ])
  expect(first?.file).toBe("/w/a.ts")
  expect(second).toBeNull()
  expect(third?.file).toBe("/w/c.ts")
})

test("the paths drawn together go in one call, cut at 200, so a path past them is still a link", async () => {
  const sent: string[][] = []
  const find = finder(async (paths) => {
    sent.push(paths)
    return paths.map(located)
  })
  const paths = Array.from({ length: 401 }, (_, n) => `f${n}.ts`)
  const files = await Promise.all(paths.map(find))
  expect(sent.map((batch) => batch.length)).toEqual([200, 200, 1])
  expect(files.map((file) => file?.asked)).toEqual(paths)
})

test("a machine that does not answer leaves its paths text", async () => {
  const find = finder(() => Promise.reject(new Error("There is no method")))
  expect(await find("a.ts")).toBeNull()
})
