import { expect, test } from "vitest"
import {
  definePreviewer,
  type Match,
  type Previewer,
  type PreviewProps,
} from "../module"
import {
  extensionOf,
  headLength,
  matchOf,
  pickPreviewer,
  previewOf,
  previewersFor,
  wantsHead,
} from "./previewers"

const view = () => Promise.resolve({ default: () => null })
const can = { quick: true, edit: false, find: false }
const previewer = (id: string, match: Match, priority = 0): Previewer =>
  definePreviewer({ id, title: id, match, priority, can, load: view })

const code = previewer(
  "files.code",
  { extensions: ["ts", "html"], mimes: ["text/*"] },
  10
)
const markdown = previewer(
  "files.markdown",
  { extensions: ["md"], mimes: ["text/markdown"] },
  20
)
const page = previewer(
  "files.page",
  { extensions: ["html", "svg"], mimes: ["text/html"] },
  20
)
const image = previewer(
  "files.image",
  { extensions: ["png", "svg"], mimes: ["image/png", "image/svg+xml"] },
  30
)
const pdf = previewer(
  "files.pdf",
  {
    extensions: ["pdf"],
    mimes: ["application/pdf"],
    magic: [{ bytes: "%PDF-" }],
  },
  30
)
const mp4 = previewer(
  "files.video",
  { mimes: ["video/*"], magic: [{ at: 4, bytes: "ftyp" }] },
  30
)
const ALL = [code, markdown, page, image, pdf, mp4]
const ids = (found: readonly Previewer[]) => found.map((one) => one.id)
const bytes = (text: string) => new TextEncoder().encode(text)

test("a file's extension is its name's last part, lower case", () => {
  expect(extensionOf("/a/b/Read.ME.MD")).toBe("md")
  expect(extensionOf("/a/.env")).toBe("")
  expect(extensionOf("/a.b/Makefile")).toBe("")
})

test("a previewer matches a file by its extension, then its MIME type, then its family, then its bytes", () => {
  expect(
    matchOf(markdown, { path: "/a/notes.md", mime: "text/markdown" })
  ).toBe(0)
  expect(matchOf(markdown, { path: "/a/notes", mime: "text/markdown" })).toBe(1)
  expect(matchOf(code, { path: "/a/notes", mime: "text/markdown" })).toBe(2)
  expect(
    matchOf(pdf, { path: "/a/scan", mime: null, head: bytes("%PDF-1.7") })
  ).toBe(3)
  expect(
    matchOf(mp4, { path: "/a/clip", head: bytes("\0\0\0\x18ftypmp42") })
  ).toBe(3)
  expect(matchOf(pdf, { path: "/a/scan", head: bytes("%PD") })).toBeNull()
  expect(
    matchOf(image, { path: "/a/notes.md", mime: "text/markdown" })
  ).toBeNull()
})

test("the closest match draws a file, the higher priority among equals", () => {
  // By its extension, markdown before code, which only knows text.
  expect(
    ids(previewersFor(ALL, { path: "/a/notes.md", mime: "text/markdown" }))
  ).toEqual(["files.markdown", "files.code"])
  // Both by the extension: the page's priority is higher.
  expect(
    ids(previewersFor(ALL, { path: "/a/index.html", mime: "text/html" }))
  ).toEqual(["files.page", "files.code"])
  // An SVG is an image first, a page second.
  expect(
    pickPreviewer(ALL, { path: "/a/logo.svg", mime: "image/svg+xml" })?.id
  ).toBe("files.image")
  // No extension: its MIME's family.
  expect(
    pickPreviewer(ALL, { path: "/a/clip", mime: "video/x-matroska" })?.id
  ).toBe("files.video")
  expect(
    pickPreviewer(ALL, { path: "/a/archive.zip", mime: "application/zip" })
  ).toBeNull()
})

test("the Person's pick for an extension draws it, while the pick matches the file", () => {
  const picks = { md: "files.code", png: "files.code" }
  expect(
    pickPreviewer(ALL, { path: "/a/notes.md", mime: "text/markdown" }, picks)
      ?.id
  ).toBe("files.code")
  // Code draws no picture: the pick is passed over.
  expect(
    pickPreviewer(ALL, { path: "/a/dot.png", mime: "image/png" }, picks)?.id
  ).toBe("files.image")
  // Another extension keeps its own.
  expect(
    pickPreviewer(ALL, { path: "/a/README", mime: "text/markdown" }, picks)?.id
  ).toBe("files.markdown")
})

test("a file's first bytes are read only when its name and MIME type pick nothing", () => {
  expect(
    wantsHead(ALL, { path: "/a/scan.bin", mime: "application/octet-stream" })
  ).toBe(true)
  expect(wantsHead(ALL, { path: "/a/scan.pdf", mime: "application/pdf" })).toBe(
    false
  )
  expect(wantsHead([code], { path: "/a/scan.bin" })).toBe(false)
  expect(headLength(ALL)).toBe(8)
  expect(
    pickPreviewer(ALL, {
      path: "/a/scan.bin",
      mime: "application/octet-stream",
      head: bytes("%PDF-1.4\n"),
    })?.id
  ).toBe("files.pdf")
})

test("a file of the same kind goes to the same view, which updates; one of another kind is drawn anew", () => {
  const props = (path: string) =>
    ({
      file: {
        path,
        shown: path,
        name: path,
        mime: null,
        size: null,
        modified: null,
        url: null,
      },
      line: null,
      mode: "quick",
    }) as unknown as PreviewProps
  const first = previewOf(pdf, props("/a/one.pdf"))
  const next = previewOf(pdf, props("/a/two.pdf"))
  // React keeps an element of the same type and key, and gives it the new
  // props: the view is not drawn again.
  expect(next.type).toBe(first.type)
  expect(next.key).toBe(first.key)
  expect((next.props as PreviewProps).file.path).toBe("/a/two.pdf")
  const other = previewOf(code, props("/a/notes.ts"))
  expect(other.type).not.toBe(first.type)
  expect(other.key).not.toBe(first.key)
})
