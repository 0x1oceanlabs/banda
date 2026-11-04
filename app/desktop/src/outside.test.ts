import { expect, test } from "vitest"
import { runs } from "./outside"

const file = (mode: number) => ({ isDirectory: () => false, mode })
const folder = { isDirectory: () => true, mode: 0o40755 }

test("a program or a macOS app could run; a page, a picture or a folder could not", () => {
  expect(runs(file(0o100755), "/usr/bin/git")).toBe(true)
  expect(runs(file(0o100744), "/tmp/run.sh")).toBe(true)
  expect(runs(file(0o100644), "/tmp/notes.txt")).toBe(false)
  expect(runs(folder, "/Applications/Banda.app")).toBe(true)
  expect(runs(folder, "/home/roma/code")).toBe(false)
})
