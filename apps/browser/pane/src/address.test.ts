import { expect, test } from "vitest"
import { addressOf, isAddress, siteOf } from "./address"

test("what reads as an address opens it, and words go to the search", () => {
  expect(addressOf("github.com")).toBe("https://github.com")
  expect(addressOf(" github.com/x?y=1 ")).toBe("https://github.com/x?y=1")
  expect(addressOf("example.co.uk:8080/a")).toBe("https://example.co.uk:8080/a")
  expect(addressOf("http://example.com")).toBe("http://example.com")
  expect(addressOf("localhost:5173")).toBe("http://localhost:5173")
  expect(addressOf("127.0.0.1:8080/x")).toBe("http://127.0.0.1:8080/x")
  expect(addressOf("about:blank")).toBe("about:blank")
  expect(addressOf("tiling window manager")).toBe(
    "https://duckduckgo.com/?q=tiling%20window%20manager"
  )
  expect(addressOf("niri")).toBe("https://duckduckgo.com/?q=niri")
  expect(isAddress(" banda.so ")).toBe(true)
  expect(isAddress("localhost:5173")).toBe(true)
  expect(isAddress("niri")).toBe(false)
  expect(isAddress("banda.so is good")).toBe(false)
})

test("the row shows a page's site", () => {
  expect(siteOf("https://www.github.com/0x1oceanlabs")).toBe("github.com")
  expect(siteOf("http://127.0.0.1:5173/x")).toBe("127.0.0.1:5173")
  expect(siteOf("about:blank")).toBe("about:blank")
  expect(siteOf("file:///home/roma/notes.html")).toBe("notes.html")
  expect(siteOf("not an address")).toBe("not an address")
})

test("words go to the search browser.toml names", () => {
  expect(addressOf("a b", "https://kagi.com/search?q=%s")).toBe(
    "https://kagi.com/search?q=a%20b"
  )
})
