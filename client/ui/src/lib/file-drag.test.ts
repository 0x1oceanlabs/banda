import { afterEach, expect, test, vi } from "vitest"
import { type DeviceFile, type ProjectFile, projectFile } from "@banda/core"
import type { ProjectId } from "@banda/contract"
import { carries, droppedFiles, PATHS } from "./file-drag"
import { dragFiles } from "./file-drag-out"

afterEach(() => {
  vi.unstubAllGlobals()
})

const work = "work" as ProjectId
const of = (...paths: string[]) => paths.map((path) => projectFile(work, path))
const here = (paths: ProjectFile[]) =>
  paths.map(({ path }) => path as DeviceFile)

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
  const files = of("/w/src/main.ts", "/w/docs/")
  dragFiles(event, files, here(files))
  expect(event.preventDefault).not.toHaveBeenCalled()
  expect(data.types).toEqual([PATHS, "text/plain"])
  expect(data.effectAllowed).toBe("copy")
  expect(data.getData("text/plain")).toBe("/w/src/main.ts\n/w/docs/")
  expect(carries(data)).toBe(true)
  expect(droppedFiles(data)).toEqual(of("/w/src/main.ts", "/w/docs/"))
})

test("a file of another machine is carried by the page, with its Project, for what here may take it; none goes to main (ADR 0106, 3b)", () => {
  const dragged = vi.fn()
  desktop(dragged)
  const data = dataTransfer()
  const event = starting(data)
  const arcs = [projectFile("arc-p" as ProjectId, "/w/a.ts")]
  dragFiles(event, arcs, undefined)
  expect(event.preventDefault).not.toHaveBeenCalled()
  expect(dragged).not.toHaveBeenCalled()
  expect(droppedFiles(data)).toEqual(arcs)
})

test("an old drag of paths alone names no Project, so it is no drop of Banda's files", () => {
  const data = dataTransfer()
  data.setData(PATHS, JSON.stringify(["/w/a.ts"]))
  expect(carries(data)).toBe(true)
  expect(droppedFiles(data)).toBeNull()
})

test("text alone, or Banda's type with anything but files of a Project and whole paths, is no drop of Banda's files", () => {
  const text = dataTransfer()
  text.setData("text/plain", "/w/src/main.ts")
  expect(carries(text)).toBe(false)
  expect(droppedFiles(text)).toBeNull()
  for (const value of [
    "",
    "nope",
    "[]",
    '["src/main.ts"]',
    "[1]",
    '{"a":1}',
    '[{"project":"p","path":"src/main.ts"}]',
    '[{"project":"","path":"/w/a"}]',
    '[{"path":"/w/a"}]',
  ]) {
    const data = dataTransfer()
    data.setData(PATHS, value)
    expect(droppedFiles(data), value).toBeNull()
  }
})

test("in Banda's window main drags the files; dropped back, they are named by their paths, once, and any others are not", () => {
  const dragged = vi.fn()
  desktop(dragged)
  const event = starting()
  const files = of("/w/src/main.ts", "/w/docs/")
  dragFiles(event, files, here(files))
  expect(event.preventDefault).toHaveBeenCalled()
  expect(dragged).toHaveBeenCalledWith(["/w/src/main.ts", "/w/docs/"])
  // Not the same files: another app's.
  expect(droppedFiles(dataTransfer(["main.ts"]))).toBeNull()
  expect(droppedFiles(dataTransfer(["main.ts", "notes"]))).toBeNull()
  // A folder comes back by its name.
  expect(droppedFiles(dataTransfer(["docs", "main.ts"]))).toEqual(
    of("/w/src/main.ts", "/w/docs/")
  )
  expect(droppedFiles(dataTransfer(["docs", "main.ts"]))).toBeNull()
})

test("main's drag that ended elsewhere is forgotten as the pointer moves free", () => {
  const window = desktop(() => {})
  const move = (buttons: number) =>
    window.dispatchEvent(Object.assign(new Event("pointermove"), { buttons }))
  const one = of("/w/a.ts")
  dragFiles(starting(), one, here(one))
  // Still held: the drag is starting.
  move(1)
  move(0)
  expect(droppedFiles(dataTransfer(["a.ts"]))).toBeNull()
})
