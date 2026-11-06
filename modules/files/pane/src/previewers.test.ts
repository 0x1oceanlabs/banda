import { pickPreviewer, previewersFor } from "@banda/ui/lib/previewers"
import { expect, test } from "vitest"
import { PREVIEWERS } from "./previewers"

/** Which of Files' previewers draws the file at `path` of `mime`. */
const drawn = (path: string, mime: string | null, head?: string) =>
  pickPreviewer(PREVIEWERS, {
    path,
    mime,
    ...(head !== undefined && { head: new TextEncoder().encode(head) }),
  })?.id ?? null

test("markdown, a picture or code, by the extension first, then the MIME", () => {
  expect(drawn("/p/README.md", "text/markdown")).toBe("files.markdown")
  expect(drawn("/p/notes", "text/markdown")).toBe("files.markdown")
  expect(drawn("/p/shot.png", "image/png")).toBe("files.image")
  // An SVG is a picture, drawn as one; a page, or its text, by a pick.
  expect(drawn("/p/logo.svg", "image/svg+xml")).toBe("files.image")
  expect(
    previewersFor(PREVIEWERS, { path: "/p/logo.svg" }).map((one) => one.id)
  ).toEqual(["files.image", "files.page", "files.code"])
  // A picture with no extension, by its first bytes as the engine read
  // them.
  expect(drawn("/p/picture", "image/png")).toBe("files.image")
  expect(drawn("/p/src/main.rs", "text/x-rust")).toBe("files.code")
})

test("TypeScript is code, though the MIME tables call `.ts` video", () => {
  expect(drawn("/p/app.ts", "video/mp2t")).toBe("files.code")
  expect(drawn("/p/data.json", "application/json")).toBe("files.code")
})

test("a PDF, video, sound and a page each have theirs; text of any other kind is read", () => {
  expect(drawn("/p/paper.pdf", "application/pdf")).toBe("files.pdf")
  expect(drawn("/p/clip.mp4", "video/mp4")).toBe("files.video")
  expect(drawn("/p/clip.mkv", "video/x-matroska")).toBe("files.video")
  expect(drawn("/p/song.flac", "audio/flac")).toBe("files.audio")
  expect(drawn("/p/index.html", "text/html")).toBe("files.page")
  expect(drawn("/p/LICENSE", "text/plain")).toBe("files.code")
})

test("bytes of no kind it knows are looked at, and else have their facts", () => {
  expect(drawn("/p/scan.bin", "application/octet-stream", "%PDF-1.7")).toBe(
    "files.pdf"
  )
  expect(drawn("/p/blob", "application/octet-stream", "\0\0\0")).toBeNull()
  // Chromium draws no HEIC, nor a zip: their facts.
  expect(drawn("/p/photo.heic", "image/heic")).toBeNull()
  expect(drawn("/p/all.zip", "application/zip")).toBeNull()
})

test("the Person's pick for an extension draws it: markdown as code", () => {
  expect(
    pickPreviewer(
      PREVIEWERS,
      { path: "/p/README.md", mime: "text/markdown" },
      { md: "files.code" }
    )?.id
  ).toBe("files.code")
})
