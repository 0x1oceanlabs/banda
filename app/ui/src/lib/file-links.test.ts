import { describe, expect, it } from "vitest"
import {
  codePath,
  filePath,
  fileUrl,
  lineText,
  linkPath,
  named,
  textPaths,
} from "./file-links"

describe("a path's line", () => {
  it("is read in each way a reply writes it", () => {
    expect(named("src/a.ts")).toEqual({ path: "src/a.ts" })
    expect(named("src/a.ts:12")).toEqual({ path: "src/a.ts", line: 12 })
    expect(named("src/a.ts:12:3")).toEqual({
      path: "src/a.ts",
      line: 12,
      column: 3,
    })
    expect(named("src/a.ts#L12")).toEqual({ path: "src/a.ts", line: 12 })
    expect(named("src/a.ts#L12C3")).toEqual({
      path: "src/a.ts",
      line: 12,
      column: 3,
    })
    expect(lineText({ line: 12, column: 3 })).toBe(":12:3")
    expect(lineText({})).toBe("")
  })
})

describe("inline code", () => {
  it("is a path with a slash or a line, and a file's shape", () => {
    for (const code of [
      "src/thread/Message.tsx:42",
      "Message.tsx:42",
      "/etc/hosts",
      "~/notes.md",
      "./run",
      "../a/b",
      "docs/adr/0063-paths.md",
      "src/a.ts#L3",
      "@banda/ui/lib/x.ts",
    ])
      expect(codePath(code), code).not.toBeNull()
  })

  it("is not a word, a host, a port, a version, a command or a package", () => {
    for (const code of [
      "Message.tsx",
      "localhost:3000",
      "127.0.0.1:8080",
      "example.com/a.html",
      "banda.so/docs",
      "v1.2.3",
      "react-dom/client",
      "lib/1.2.3",
      "npm run build",
      "https://example.com/a.ts",
      "src/",
      "node:fs",
    ])
      expect(codePath(code), code).toBeNull()
  })
})

describe("a Markdown link", () => {
  it("names a file by its path, from the root, home or the folder", () => {
    expect(linkPath("src/a.ts")).toEqual({ path: "src/a.ts" })
    expect(linkPath("/home/me/a.ts#L4")).toEqual({
      path: "/home/me/a.ts",
      line: 4,
    })
    expect(linkPath("docs/My%20File.md#usage")).toEqual({
      path: "docs/My File.md",
    })
    expect(linkPath("~/a.md")).toEqual({ path: "~/a.md" })
  })

  it("is not a page, a place, or another scheme", () => {
    for (const href of [
      "https://example.com",
      "#user-content-fn-1",
      "mailto:a@b.c",
      "//cdn.example.com/a.js",
      "",
    ])
      expect(linkPath(href), href).toBeNull()
  })

  it("takes a file:// URL's path, and makes one", () => {
    expect(fileUrl("/home/me/My a.ts")).toBe("file:///home/me/My%20a.ts")
    expect(filePath("file:///home/me/My%20a.ts#L2")).toBe("/home/me/My a.ts#L2")
    expect(filePath("file://localhost/etc/hosts")).toBe("/etc/hosts")
    expect(filePath("file://server/share/a.ts")).toBeNull()
    expect(filePath("https://example.com")).toBeNull()
  })
})

describe("plain text", () => {
  it("has paths with a slash and an extension, and their lines", () => {
    const text =
      "Edit src/thread/Message.tsx:42, then ~/notes.md and docs/a.md. Done."
    expect(textPaths(text).map((one) => one.text)).toEqual([
      "src/thread/Message.tsx:42",
      "~/notes.md",
      "docs/a.md",
    ])
    expect(textPaths(text)[0]).toMatchObject({
      start: 5,
      named: { path: "src/thread/Message.tsx", line: 42 },
    })
  })

  it("has none in words, hosts, URLs or fractions", () => {
    for (const text of [
      "and/or either way",
      "see example.com/page.html",
      "at https://example.com/a/b.html",
      "1/2.5 of it",
      "README.md alone",
    ])
      expect(textPaths(text), text).toEqual([])
  })
})
