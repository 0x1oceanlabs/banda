import { expect, test } from "vitest"
import { kindWords, sizeWords } from "./words"

const file = (path: string, mime?: string) => ({
  path,
  kind: "file" as const,
  mime,
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
