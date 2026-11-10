/** A file written whole from bytes as they come. */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import { afterEach, beforeEach, expect, it } from "vitest"
import { writeWholeFrom } from "./whole"

let folder: string
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "banda-whole-"))
})
afterEach(() => rmSync(folder, { recursive: true, force: true }))

it("two saves to one file at once each land whole, and nothing else is left", async () => {
  const file = join(folder, "shot.png")
  const first = new PassThrough()
  const second = new PassThrough()
  const going = [writeWholeFrom(file, first), writeWholeFrom(file, second)]
  first.write("AAAAAAAAAA")
  second.write("BBBB")
  await new Promise((done) => setTimeout(done, 20))
  first.end("AAAAA")
  second.end("BB")
  await Promise.all(going)
  expect(["A".repeat(15), "B".repeat(6)]).toContain(readFileSync(file, "utf8"))
  expect(readdirSync(folder)).toEqual(["shot.png"])
})
