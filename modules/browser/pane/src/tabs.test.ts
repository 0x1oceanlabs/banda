import { expect, test } from "vitest"
import {
  afterTabKey,
  type BrowserArgs,
  keepClosed,
  lastClosed,
  readArgs,
  showing,
  stepped,
  type Tab,
  withChanged,
  withoutTab,
  withTab,
} from "./tabs"

const tab = (id: string): Tab => ({ id, url: `https://${id}.test/`, title: id })
const of = (ids: string, shown: number): BrowserArgs => ({
  tabs: [...ids].map(tab),
  shown,
})
const ids = (args: BrowserArgs | null) =>
  args && `${args.tabs.map((t) => t.id).join("")}:${args.shown}`

test("a new tab goes last and shows; one opened by a link goes beside it", () => {
  expect(ids(withTab(of("ab", 0), tab("c")))).toBe("abc:2")
  expect(ids(withTab(of("abc", 0), tab("d"), 1))).toBe("adbc:1")
  // In the background, the tab that showed still shows.
  expect(ids(withTab(of("abc", 1), tab("d"), 1, true))).toBe("adbc:2")
  expect(ids(withTab(of("", 0), tab("a"), 0, true))).toBe("a:0")
})

test("closing the shown tab shows the one to its right, or else its left", () => {
  expect(ids(withoutTab(of("abc", 1), 1))).toBe("ac:1")
  expect(ids(withoutTab(of("abc", 2), 2))).toBe("ab:1")
  expect(ids(withoutTab(of("abc", 1), 0))).toBe("bc:0")
  expect(ids(withoutTab(of("abc", 0), 2))).toBe("ab:0")
  expect(withoutTab(of("a", 0), 0)).toBeNull()
})

test("Ctrl+Tab goes round the ends, and Ctrl+9 is the last", () => {
  expect(ids(stepped(of("abc", 2), 1))).toBe("abc:0")
  expect(ids(stepped(of("abc", 0), -1))).toBe("abc:2")
  expect(ids(showing(of("abc", 0), 8))).toBe("abc:2")
  expect(ids(showing(of("abc", 2), 0))).toBe("abc:0")
})

test("a tab's change is kept only when it changed", () => {
  const args = of("ab", 0)
  expect(withChanged(args, tab("a"))).toBe(args)
  expect(withChanged(args, { ...tab("b"), title: "B" }).tabs[1]?.title).toBe(
    "B"
  )
})

test("a closed tab opens again, the last first; a blank one is not kept", () => {
  keepClosed(tab("a"))
  keepClosed({ id: "x", url: "", title: "" })
  keepClosed(tab("b"))
  expect(lastClosed()?.id).toBe("b")
  expect(lastClosed()?.id).toBe("a")
  expect(lastClosed()).toBeUndefined()
})

test("the tab keys do what Chrome's do", () => {
  const args = of("abc", 1)
  expect(ids(afterTabKey(args, "tab-new", "n"))).toBe("abcn:3")
  expect(ids(afterTabKey(args, "tab-next", "n"))).toBe("abc:2")
  expect(ids(afterTabKey(args, "tab-previous", "n"))).toBe("abc:0")
  expect(ids(afterTabKey(args, "tab-1", "n"))).toBe("abc:0")
  expect(ids(afterTabKey(of("abcdefghij", 0), "tab-9", "n"))).toBe(
    "abcdefghij:9"
  )
  const closed = afterTabKey(args, "tab-close", "n")
  expect(ids(closed)).toBe("ac:1")
  expect(ids(afterTabKey(closed!, "tab-reopen", "r"))).toBe("acr:2")
  expect(afterTabKey(of("a", 0), "tab-close", "n")).toBeNull()
  lastClosed()
})

test("an address alone is a browser at it; the Pane's own args stay as they are", () => {
  const own = of("ab", 1)
  expect(readArgs(own, "x")).toBe(own)
  expect(readArgs({ url: "https://a.test/" }, "x")).toEqual({
    tabs: [{ id: "x", url: "https://a.test/", title: "" }],
    shown: 0,
  })
  expect(readArgs({ url: "" }, "x")).toEqual({ tabs: [], shown: 0 })
})
