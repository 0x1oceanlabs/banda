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
import type { Engine as Client } from "@banda/contract"
import { afterEach, beforeEach, expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Engine } from "./engine"
import { byteRange, FileHost, FileLinks } from "./files"

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "banda-files-"))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** The engine, as far as the host asks it: one Project, `p`, in `dir`. */
const engine = () =>
  Layer.succeed(Engine)({
    address: Effect.die("unused"),
    client: Effect.succeed({
      call: async () => [{ id: "p", folder: dir }],
    } as unknown as Client),
    door: Effect.die("unused"),
  })

/** What `links` serves at `url`, with `range` if given. */
const fetched = (links: FileLinks, url: string, range?: string) =>
  links.serve(new Request(url, range ? { headers: { range } } : {}), 1)

it.effect(
  "the runtime signs media; the response is typed, streamed, and may be read in ranges",
  () =>
    Effect.gen(function* () {
      const path = join(dir, "a clip.mp4")
      yield* Effect.promise(() => writeFile(path, "0123456789"))
      const files = yield* FileHost
      const url = yield* files.issue(path, "media")
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
    }).pipe(Effect.provide(FileHost.layer))
)

it("serves any file, typed by its extension: text as plain text, what it does not know as bytes", async () => {
  const links = new FileLinks()
  const types = {
    "notes.txt": "text/plain; charset=utf-8",
    "main.rs": "text/plain; charset=utf-8",
    "page.html": "text/plain; charset=utf-8",
    "Read Me.MD": "text/plain; charset=utf-8",
    "paper.pdf": "application/pdf",
    "face.woff2": "font/woff2",
    "shot.PNG": "image/png",
    "data.bin": "application/octet-stream",
    Makefile: "application/octet-stream",
  }
  for (const [name, type] of Object.entries(types)) {
    await writeFile(join(dir, name), "<script>alert(1)</script>")
    const response = await fetched(
      links,
      (await links.issue(join(dir, name), 0))!
    )
    expect(response.status, name).toBe(200)
    expect(response.headers.get("content-type"), name).toBe(type)
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; sandbox"
    )
    expect(await response.text()).toBe("<script>alert(1)</script>")
  }
})

it("media alone is what a reply's links may ask for, and a link may not turn into another kind", async () => {
  const links = new FileLinks()
  await writeFile(join(dir, "secret.txt"), "secret")
  await writeFile(join(dir, "image.png"), "image")
  await symlink(join(dir, "secret.txt"), join(dir, "looks like.png"))
  expect(await links.issue(join(dir, "secret.txt"), 0, "media")).toBeNull()
  expect(await links.issue(join(dir, "looks like.png"), 0, "media")).toBeNull()
  expect(await links.issue(join(dir, "image.png"), 0, "media")).toMatch(
    /^app:\/\/files\//
  )
  // A Pane the Person drives asks for any file: the link's target is served
  // as what it is.
  const url = (await links.issue(join(dir, "looks like.png"), 0))!
  const response = await fetched(links, url)
  expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8")
  expect(await response.text()).toBe("secret")
})

it("refuses tampering, expiry, a different signer, missing files, folders and paths not local", async () => {
  const links = new FileLinks()
  const path = join(dir, "image.png")
  await writeFile(path, "image")
  const url = (await links.issue(path, 100))!
  expect((await links.serve(new Request(url), 3600100)).status).toBe(404)
  expect((await new FileLinks().serve(new Request(url), 100)).status).toBe(404)
  expect((await links.serve(new Request(url + "x"), 100)).status).toBe(404)
  expect(await links.issue(join(dir, "absent.png"), 100)).toBeNull()
  expect(await links.issue("~/image.png", 100)).toBeNull()
  expect(await links.issue("//server/image.png", 100)).toBeNull()
  expect(await links.issue("image.png", 100)).toBeNull()
  await mkdir(join(dir, "folder.png"))
  expect(await links.issue(join(dir, "folder.png"), 100)).toBeNull()
  expect(await links.issue(dir, 100)).toBeNull()
})

it("a replaced inode or a path redirected through a symlink does not use an old grant", async () => {
  const links = new FileLinks()
  for (const name of ["image.png", "notes.txt"]) {
    const path = join(dir, name)
    await writeFile(path, "original")
    const url = (await links.issue(path, 0))!
    expect((await fetched(links, url)).status).toBe(200)
    await rename(path, join(dir, `original ${name}`))
    await writeFile(path, "replacement")
    expect((await fetched(links, url)).status).toBe(404)
    await rm(path)
    await symlink(join(dir, `original ${name}`), path)
    expect((await fetched(links, url)).status).toBe(404)
  }
})

it("any file is read in ranges; one past its end is refused with its size", async () => {
  const links = new FileLinks()
  const path = join(dir, "log.txt")
  await writeFile(path, "0123456789")
  const url = (await links.issue(path, 0))!
  const tail = await fetched(links, url, "bytes=-4")
  expect(tail.status).toBe(206)
  expect(tail.headers.get("content-range")).toBe("bytes 6-9/10")
  expect(tail.headers.get("content-length")).toBe("4")
  expect(await tail.text()).toBe("6789")
  const past = await fetched(links, url, "bytes=10-")
  expect(past.status).toBe(416)
  expect(past.headers.get("content-range")).toBe("bytes */10")
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

it.effect(
  "a path starts at the Project's folder; an unknown Project, home, the network and a scheme get none",
  () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => writeFile(join(dir, "notes.md"), "# Notes"))
      const url = yield* FileHost.url("p", "notes.md")
      const response = yield* FileHost.use((host) =>
        host.serve(new Request(url!))
      )
      expect(yield* Effect.promise(() => response.text())).toBe("# Notes")
      expect(yield* FileHost.url("p", join(dir, "notes.md"))).toMatch(
        /^app:\/\/files\//
      )
      expect(yield* FileHost.url("p", "notes.md", "media")).toBeNull()
      expect(yield* FileHost.url("other", "notes.md")).toBeNull()
      for (const path of [
        "",
        "~/notes.md",
        `file://${join(dir, "notes.md")}`,
        "//server/notes.md",
      ])
        expect(yield* FileHost.url("p", path), path).toBeNull()
    }).pipe(Effect.provide(Layer.merge(FileHost.layer, engine())))
)
