import {
  mkdtemp,
  mkdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { byteRange, FileLinks, Files } from "./files"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "banda-media-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

it.effect(
  "the runtime signs media; the response is typed, streamed, and may be read in ranges",
  () =>
    Effect.gen(function* () {
      const path = join(dir, "a clip.mp4")
      yield* Effect.promise(() => writeFile(path, "0123456789"))
      const files = yield* Files
      const url = yield* files.issue(path)
      expect(url).toMatch(/^app:\/\/files\//)
      const full = yield* files.serve(new Request(url!))
      expect(full.status).toBe(200)
      expect(full.headers.get("content-type")).toBe("video/mp4")
      expect(full.headers.get("x-content-type-options")).toBe("nosniff")
      expect(yield* Effect.promise(() => full.text())).toBe("0123456789")
      const partial = yield* files.serve(
        new Request(url!, { headers: { range: "bytes=3-6" } })
      )
      expect(partial.status).toBe(206)
      expect(partial.headers.get("content-range")).toBe("bytes 3-6/10")
      expect(yield* Effect.promise(() => partial.text())).toBe("3456")
      const head = yield* files.serve(new Request(url!, { method: "HEAD" }))
      expect(head.headers.get("content-length")).toBe("10")
      expect(yield* Effect.promise(() => head.text())).toBe("")
    }).pipe(Effect.provide(Files.layer))
)

it("refuses tampering, expiry, a different signer, missing and unsupported files", async () => {
  const links = new FileLinks()
  const path = join(dir, "image.png")
  await writeFile(path, "image")
  const url = (await links.issue(path, 100))!
  expect((await links.serve(new Request(url), 3600100)).status).toBe(404)
  expect((await new FileLinks().serve(new Request(url), 100)).status).toBe(404)
  expect((await links.serve(new Request(url + "x"), 100)).status).toBe(404)
  expect(await links.issue(join(dir, "absent.png"), 100)).toBeNull()
  expect(await links.issue(join(dir, "secret.txt"), 100)).toBeNull()
  expect(await links.issue("~/image.png", 100)).toBeNull()
  expect(await links.issue("//server/image.png", 100)).toBeNull()
  await mkdir(join(dir, "folder.png"))
  expect(await links.issue(join(dir, "folder.png"), 100)).toBeNull()
})

it("a replaced inode or a path redirected through a symlink does not use an old grant", async () => {
  const links = new FileLinks()
  const path = join(dir, "image.png")
  await writeFile(path, "original")
  const url = (await links.issue(path, 0))!
  await rename(path, join(dir, "original.png"))
  await writeFile(path, "replacement")
  expect((await links.serve(new Request(url), 1)).status).toBe(404)
  await rm(path)
  await symlink(join(dir, "original.png"), path)
  expect((await links.serve(new Request(url), 1)).status).toBe(404)
})

it("range bounds include suffixes and open ends, and refuse invalid or unsatisfiable ranges", () => {
  expect(byteRange("bytes=2-", 10)).toEqual([2, 9])
  expect(byteRange("bytes=-3", 10)).toEqual([7, 9])
  expect(byteRange("bytes=2-100", 10)).toEqual([2, 9])
  for (const range of [
    "bytes=10-",
    "bytes=-0",
    "bytes=3-2",
    "bytes=0-1,3-4",
    "bytes=-",
    "bytes=1e3-",
  ])
    expect(byteRange(range, 10)).toBeNull()
  expect(byteRange("bytes=0-", 0)).toBeNull()
})
