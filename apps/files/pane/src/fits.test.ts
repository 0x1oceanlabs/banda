import { expect, test } from "vitest"
import { fits } from "./fits"

const paths = ["src/main.ts", "src/util.ts", "docs/notes.md", "README.md"]

test("a path fits the words with their letters in order, each word on its own", () => {
  expect(paths.filter(fits("util"))).toEqual(["src/util.ts"])
  expect(paths.filter(fits("mts"))).toEqual(["src/main.ts"])
  expect(paths.filter(fits("ts src"))).toEqual(["src/main.ts", "src/util.ts"])
  expect(paths.filter(fits("tu"))).toEqual([])
  expect(paths.filter(fits(""))).toEqual(paths)
})

test("the case counts only once a capital is typed, as nucleo's smart case", () => {
  expect(paths.filter(fits("readme"))).toEqual(["README.md"])
  expect(paths.filter(fits("README"))).toEqual(["README.md"])
  expect(paths.filter(fits("Main"))).toEqual([])
})

test("nucleo's signs fit none until the engine answers", () => {
  for (const words of ["^src", "'util", "!main", "ts$", "a\\ b"])
    expect(paths.filter(fits(words))).toEqual([])
})
