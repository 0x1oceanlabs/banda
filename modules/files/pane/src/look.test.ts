import { expect, test } from "vitest"
import { kindWords, lookOf, sizeWords } from "./look"

const file = (path: string, mime?: string) => ({
  path,
  kind: "file" as const,
  mime,
})

test("markdown, an image or code, by the extension first, then the MIME", () => {
  expect(lookOf(file("/p/README.md", "text/markdown"))).toBe("markdown")
  expect(lookOf(file("/p/notes", "text/markdown"))).toBe("markdown")
  expect(lookOf(file("/p/shot.png", "image/png"))).toBe("image")
  // An SVG is a picture, drawn as one.
  expect(lookOf(file("/p/logo.svg", "image/svg+xml"))).toBe("image")
  // A picture with no extension, by its first bytes.
  expect(lookOf(file("/p/picture", "image/png"))).toBe("image")
  expect(lookOf(file("/p/src/main.rs", "text/x-rust"))).toBe("code")
})

test("TypeScript is code, though the MIME tables call `.ts` video", () => {
  expect(lookOf(file("/p/app.ts", "video/mp2t"))).toBe("code")
  expect(lookOf(file("/p/data.json", "application/json"))).toBe("code")
})

test("text of any other kind is read, and what is never text has its facts", () => {
  expect(lookOf(file("/p/LICENSE", "text/plain"))).toBe("code")
  expect(lookOf(file("/p/Makefile", undefined))).toBe("code")
  expect(lookOf(file("/p/clip.mp4", "video/mp4"))).toBe("other")
  expect(lookOf(file("/p/paper.pdf", "application/pdf"))).toBe("other")
  // Bytes of no known kind are read, and say they are binary.
  expect(lookOf(file("/p/blob", "application/octet-stream"))).toBe("code")
  // Chromium draws no HEIC: its facts.
  expect(lookOf(file("/p/photo.heic", "image/heic"))).toBe("other")
  expect(lookOf({ path: "/p/src", kind: "folder" })).toBe("folder")
})

test("a file's kind and size, in words", () => {
  expect(kindWords(file("/p/clip.mp4", "video/mp4"))).toBe("MP4 video")
  expect(kindWords(file("/p/a.pdf", "application/pdf"))).toBe("PDF document")
  expect(kindWords(file("/p/blob", "application/octet-stream"))).toBe("File")
  expect(kindWords({ path: "/p/src", kind: "folder" })).toBe("Folder")
  expect(sizeWords(1)).toBe("1 byte")
  expect(sizeWords(999)).toBe("999 bytes")
  expect(sizeWords(1_234)).toBe("1.2 KB")
  expect(sizeWords(4_000_000)).toBe("4 MB")
  expect(sizeWords(56_700_000)).toBe("57 MB")
})
