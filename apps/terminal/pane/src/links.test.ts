import { expect, test } from "vitest"
import { outsideOf, targetOf } from "./links"

const at = {
  program: "cargo test",
  folder: "~/code/banda",
  path: "/home/roma/code/banda",
  home: "/home/roma",
}

test("a page goes as it is", () => {
  expect(targetOf("http://localhost:5173/", at)).toEqual({
    link: { url: "http://localhost:5173/" },
  })
  expect(targetOf("HTTPS://example.com/a?b", undefined)).toEqual({
    link: { url: "HTTPS://example.com/a?b" },
  })
})

test("a page is a Link: no other scheme a program prints reaches the device", () => {
  expect(targetOf("file:///etc/passwd", at)).toEqual({
    file: "/home/roma/code/banda/file:/etc/passwd",
  })
  expect(targetOf("app://files/x", undefined)).toBeNull()
})

test("a path starts in the folder of what runs in front, and keeps its line", () => {
  expect(targetOf("src/input.ts:42:7", at)).toEqual({
    file: "/home/roma/code/banda/src/input.ts",
    line: 42,
  })
  expect(targetOf("./a/../b.rs:3", at)).toEqual({
    file: "/home/roma/code/banda/b.rs",
    line: 3,
  })
  expect(targetOf("/a/b.rs:3:3", at)).toEqual({ file: "/a/b.rs", line: 3 })
  expect(targetOf("../other/x.md", at)).toEqual({
    file: "/home/roma/code/other/x.md",
  })
  expect(targetOf("/etc/hosts", at)).toEqual({ file: "/etc/hosts" })
})

test("~ is the home folder, wherever what runs in front is", () => {
  expect(targetOf("~/notes.md", at)).toEqual({ file: "/home/roma/notes.md" })
  const etc = { ...at, folder: "/etc", path: "/etc" }
  expect(targetOf("~/a/b", etc)).toEqual({ file: "/home/roma/a/b" })
  expect(targetOf("~/a/b", { ...etc, home: null })).toBeNull()
})

test("with no folder only a full path goes anywhere, and never a Windows one", () => {
  expect(targetOf("src/a.ts", undefined)).toBeNull()
  expect(targetOf("/tmp/a.log", undefined)).toEqual({ file: "/tmp/a.log" })
  expect(targetOf("C:\\Users\\a.txt", at)).toBeNull()
})

test("outside Banda, a page goes to the browser and a file to its app", () => {
  expect(outsideOf({ link: { url: "https://a.b/" } })).toBe(
    "in external browser"
  )
  expect(outsideOf({ file: "/a" })).toBe("in its app")
})
