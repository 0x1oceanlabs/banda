import { expect, test } from "vitest"
import { agoWords, kindWords, modeWords, sizeWords } from "./words"

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

test("permissions read as ls writes them, with chmod's bits", () => {
  expect(modeWords(0o644)).toBe("rw-r--r-- (644)")
  expect(modeWords(0o755)).toBe("rwxr-xr-x (755)")
  expect(modeWords(0o600)).toBe("rw------- (600)")
  expect(modeWords(0o4755)).toBe("rwxr-xr-x (4755)")
})

test("a time ago reads in a word or two, and as its day past a month", () => {
  const now = Date.UTC(2026, 10, 6, 12)
  expect(agoWords(now - 3_000, now)).toBe("just now")
  expect(agoWords(now - 40_000, now)).toBe("40 seconds ago")
  expect(agoWords(now - 60_000, now)).toBe("1 minute ago")
  expect(agoWords(now - 5 * 3_600_000, now)).toBe("5 hours ago")
  expect(agoWords(now - 3 * 86_400_000, now)).toBe("3 days ago")
  expect(agoWords(now - 60 * 86_400_000, now)).not.toContain("ago")
})
