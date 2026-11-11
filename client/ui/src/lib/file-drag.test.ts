import { afterEach, expect, test, vi } from "vitest"
import { carries, droppedPaths, PATHS } from "./file-drag"
import { dragFiles } from "./file-drag-out"

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A drag's data, as the page holds it, with the files it carries. */
function dataTransfer(names: readonly string[] = []): DataTransfer {
  const data = new Map<string, string>()
  return {
    effectAllowed: "uninitialized",
    files: names.map((name) => ({ name }) as File),
    get types() {
      return [...data.keys()]
    },
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
  } as unknown as DataTransfer
}

/** A drag starting, with its data. */
const starting = (data = dataTransfer()) =>
  ({ dataTransfer: data, preventDefault: vi.fn() }) as unknown as DragEvent

/** Banda's desktop window, whose main drags `dragged`; none outside it. */
function desktop(dragged: (paths: readonly string[]) => void) {
  const window = Object.assign(new EventTarget(), {
    banda: { files: { drag: dragged } },
  })
  vi.stubGlobal("window", window)
  return window
}

test("outside Banda's window the page runs the drag: Banda's own type, and the paths as plain text, a line each", () => {
  const data = dataTransfer()
  const event = starting(data)
  dragFiles(event, ["/w/src/main.ts", "/w/docs/"])
  expect(event.preventDefault).not.toHaveBeenCalled()
  expect(data.types).toEqual([PATHS, "text/plain"])
  expect(data.effectAllowed).toBe("copy")
  expect(data.getData("text/plain")).toBe("/w/src/main.ts\n/w/docs/")
  expect(carries(data)).toBe(true)
  expect(droppedPaths(data)).toEqual(["/w/src/main.ts", "/w/docs/"])
})

test("text alone, or Banda's type with anything but whole paths, is no drop of Banda's files", () => {
  const text = dataTransfer()
  text.setData("text/plain", "/w/src/main.ts")
  expect(carries(text)).toBe(false)
  expect(droppedPaths(text)).toBeNull()
  for (const value of ["", "nope", "[]", '["src/main.ts"]', "[1]", '{"a":1}']) {
    const data = dataTransfer()
    data.setData(PATHS, value)
    expect(droppedPaths(data), value).toBeNull()
  }
})

test("in Banda's window main drags the files; dropped back, they are named by their paths, once, and any others are not", () => {
  const dragged = vi.fn()
  desktop(dragged)
  const event = starting()
  dragFiles(event, ["/w/src/main.ts", "/w/docs/"])
  expect(event.preventDefault).toHaveBeenCalled()
  expect(dragged).toHaveBeenCalledWith(["/w/src/main.ts", "/w/docs/"])
  // Not the same files: another app's.
  expect(droppedPaths(dataTransfer(["main.ts"]))).toBeNull()
  expect(droppedPaths(dataTransfer(["main.ts", "notes"]))).toBeNull()
  // A folder comes back by its name.
  expect(droppedPaths(dataTransfer(["docs", "main.ts"]))).toEqual([
    "/w/src/main.ts",
    "/w/docs/",
  ])
  expect(droppedPaths(dataTransfer(["docs", "main.ts"]))).toBeNull()
})

test("main's drag that ended elsewhere is forgotten as the pointer moves free", () => {
  const window = desktop(() => {})
  const move = (buttons: number) =>
    window.dispatchEvent(Object.assign(new Event("pointermove"), { buttons }))
  dragFiles(starting(), ["/w/a.ts"])
  // Still held: the drag is starting.
  move(1)
  move(0)
  expect(droppedPaths(dataTransfer(["a.ts"]))).toBeNull()
})
