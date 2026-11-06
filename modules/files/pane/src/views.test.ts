import type { Entry } from "@banda/contract/files"
import { expect, test } from "vitest"
import type { Listed } from "./tree"
import {
  columnsOf,
  entryOf,
  listedFor,
  moved,
  rowsIn,
  FILM,
  filmScroll,
  filmWindow,
  viewOf,
} from "./views"

const file = (name: string, more: Partial<Entry> = {}): Entry => ({
  name,
  kind: "file",
  ...more,
})
const folder = (name: string): Entry => ({ name, kind: "folder" })

/** A folder: `src/` holds `lib/` and two files, `lib/` one, and a
 * dotfile at the top. */
const listed: Listed = new Map([
  ["", [folder("src"), file("README.md"), file(".env", { hidden: true })]],
  ["src/", [folder("lib"), file("a.ts"), file("b.ts")]],
  ["src/lib/", [file("c.ts")]],
])
const showing = { hidden: false, ignored: true }
const rows = (of: string) => rowsIn(listed, of, showing)

test("a Pane's view is the one its args name, else the List", () => {
  expect(viewOf(undefined)).toBe("list")
  expect(viewOf("columns")).toBe("columns")
  expect(viewOf("gallery")).toBe("gallery")
  expect(viewOf("grid")).toBe("list")
})

test("a folder's rows are its names, a folder's with its /, the hidden left out", () => {
  expect(rows("")).toEqual(["src/", "README.md"])
  expect(rows("src/")).toEqual(["src/lib/", "src/a.ts", "src/b.ts"])
  expect(rows("nowhere/")).toEqual([])
  expect(rowsIn(listed, "", { hidden: true, ignored: true })).toContain(".env")
  expect(entryOf(listed, "src/lib/")?.kind).toBe("folder")
  expect(entryOf(listed, "src/a.ts")?.name).toBe("a.ts")
})

test("the columns run from the top to the pick, a folder picked opening the next", () => {
  expect(columnsOf(null)).toEqual([""])
  expect(columnsOf("README.md")).toEqual([""])
  expect(columnsOf("src/")).toEqual(["", "src/"])
  expect(columnsOf("src/a.ts")).toEqual(["", "src/"])
  expect(columnsOf("src/lib/c.ts")).toEqual(["", "src/", "src/lib/"])
})

test("each view lists the folders it shows", () => {
  const open = ["src/"]
  // The tree, its open folders.
  expect(listedFor("list", "src/lib/c.ts", open)).toBe(open)
  // Columns, each folder to the pick, and a folder picked.
  expect(listedFor("columns", "src/lib/", open)).toEqual(["src/", "src/lib/"])
  expect(listedFor("columns", null, open)).toEqual([])
  // The Gallery, the pick's folder and those on its way.
  expect(listedFor("gallery", "src/lib/c.ts", open)).toEqual([
    "src/",
    "src/lib/",
  ])
  expect(listedFor("gallery", "README.md", open)).toEqual([])
})

test("in Columns ↑ ↓ move in a column, → goes into a folder, ← back out", () => {
  expect(moved("columns", "down", null, rows)).toBe("src/")
  expect(moved("columns", "down", "src/", rows)).toBe("README.md")
  expect(moved("columns", "down", "README.md", rows)).toBeNull()
  expect(moved("columns", "up", "README.md", rows)).toBe("src/")
  expect(moved("columns", "right", "src/", rows)).toBe("src/lib/")
  expect(moved("columns", "right", "src/lib/", rows)).toBe("src/lib/c.ts")
  // A file has nowhere to go into, nor the top anywhere to go out to.
  expect(moved("columns", "right", "src/a.ts", rows)).toBeNull()
  expect(moved("columns", "left", "src/lib/c.ts", rows)).toBe("src/lib/")
  expect(moved("columns", "left", "src/", rows)).toBeNull()
  expect(moved("columns", "end", "src/lib/", rows)).toBe("src/b.ts")
  expect(moved("columns", "home", "src/b.ts", rows)).toBe("src/lib/")
})

test("in a Gallery ← → move along the filmstrip of the pick's folder", () => {
  expect(moved("gallery", "right", "src/a.ts", rows)).toBe("src/b.ts")
  expect(moved("gallery", "left", "src/a.ts", rows)).toBe("src/lib/")
  expect(moved("gallery", "right", "src/b.ts", rows)).toBeNull()
  expect(moved("gallery", "down", "src/a.ts", rows)).toBeNull()
  // A pick gone from its folder starts it again.
  expect(moved("gallery", "right", "src/gone.ts", rows)).toBe("src/lib/")
})

test("a filmstrip draws the items in view and a few beside, never past its ends", () => {
  const step = FILM.item + FILM.gap
  // At the start, a view three items wide: those, one cut, and four more.
  expect(filmWindow({ count: 1000, scroll: 0, width: 3 * step })).toEqual({
    from: 0,
    to: 8,
  })
  // Scrolled to item 100.
  expect(
    filmWindow({ count: 1000, scroll: 100 * step + 10, width: 3 * step })
  ).toEqual({ from: 96, to: 108 })
  // Near the end, and in a short folder.
  expect(
    filmWindow({ count: 1000, scroll: 998 * step, width: 3 * step })
  ).toEqual({ from: 994, to: 1000 })
  expect(filmWindow({ count: 2, scroll: 0, width: 800 })).toEqual({
    from: 0,
    to: 2,
  })
  expect(filmWindow({ count: 0, scroll: 0, width: 0 })).toEqual({
    from: 0,
    to: 0,
  })
})

test("a filmstrip scrolls the pick to its middle, and stays while it shows whole", () => {
  const step = FILM.item + FILM.gap
  const width = 5 * step
  expect(filmScroll(2, 0, width)).toBe(0)
  // Past the right: item 9 in the middle.
  const middle = filmScroll(9, 0, width)
  expect(middle + width / 2).toBeCloseTo(FILM.gap + 9 * step + FILM.item / 2, 0)
  // Past the left, near the start: no further than the start.
  expect(filmScroll(1, 4 * step, width)).toBe(0)
  expect(filmScroll(4, 4 * step, width)).toBe(4 * step)
})
