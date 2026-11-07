import { expect, test } from "vitest"
import { fromFolder } from "./paths"

test("a message names a file in its Project from the Project's folder, a folder with its /", () => {
  expect(fromFolder("/w/src/main.ts", "/w")).toBe("src/main.ts")
  expect(fromFolder("/w/src/", "/w/")).toBe("src/")
})

test("a file outside the folder, the folder itself, or with no folder known, is named whole", () => {
  expect(fromFolder("/elsewhere/a.ts", "/w")).toBe("/elsewhere/a.ts")
  expect(fromFolder("/work/a.ts", "/w")).toBe("/work/a.ts")
  expect(fromFolder("/w/", "/w")).toBe("/w/")
  expect(fromFolder("/w/a.ts", undefined)).toBe("/w/a.ts")
  expect(fromFolder("/tmp/a.log", null)).toBe("/tmp/a.log")
})
