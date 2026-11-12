/**
 * The Pager's rules (`pager.ts`), as plain data: which workspaces stand on
 * it, and what each cell shows, is called and is reached by.
 */
import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { PaneState } from "@banda/ui/pane"
import { expect, test } from "vitest"
import type { Column, Workspaces } from "../model"
import { cellsOf, pagerStateOf } from "./pager"

const brand: ProjectSummary = {
  id: "brand",
  name: "Brand",
  folder: "/code/brand",
  pinned: false,
  archived: false,
  sees_others: false,
  sign: { kind: "letters", text: "B", picked: false },
  trusted: true,
  scratch: false,
  missing: false,
}
const pane: PaneState = { kind: "terminal.shell", args: {} }
const column = (id: string, project: ProjectId): Column => ({
  id,
  active: 0,
  entries: [{ id: `${id}e`, project, pane }],
})
const free = (id: string) => ({
  id,
  columns: [column(`${id}c`, "loose" as ProjectId)],
  focus: 0,
})
const bottom = { id: "bottom", columns: [], focus: 0 }

test("a Project's workspace shows its Sign and says whose it is; emptied, it is faint", () => {
  const state: Workspaces = {
    list: [
      { ...free("w0"), project: "brand" as ProjectId },
      { id: "w1", columns: [], focus: 0, project: "brand" as ProjectId },
      bottom,
    ],
    current: 0,
  }
  const [busy, emptied] = cellsOf(pagerStateOf(state), [brand])
  expect(busy).toEqual({
    id: "w0",
    index: 0,
    here: true,
    face: { kind: "sign", project: brand, faint: false },
    name: "Workspace 1",
    action: "workspace.go-1",
    whose: "Brand",
  })
  expect(emptied!.face).toEqual({ kind: "sign", project: brand, faint: true })
  expect(emptied!.here).toBe(false)
})

test("a free workspace shows its place as its number, and so does one of a Project the window does not know", () => {
  const state: Workspaces = {
    list: [
      free("w0"),
      { ...free("w1"), project: "archived" as ProjectId },
      bottom,
    ],
    current: 1,
  }
  const [one, two] = cellsOf(pagerStateOf(state), [brand])
  expect(one!.face).toEqual({ kind: "number", number: 1 })
  expect(two).toEqual({
    id: "w1",
    index: 1,
    here: true,
    face: { kind: "number", number: 2 },
    name: "Workspace 2",
    action: "workspace.go-2",
  })
})

test("the empty one at the bottom is the + that a new workspace starts at", () => {
  const state: Workspaces = { list: [free("w0"), bottom], current: 1 }
  expect(cellsOf(pagerStateOf(state), []).at(-1)).toEqual({
    id: "bottom",
    index: 1,
    here: true,
    face: { kind: "new" },
    name: "New workspace",
    action: "workspace.new",
  })
})

test("a number is the workspace's place, so a Sign takes a place too, and an emptied free one the window has left stands on no cell", () => {
  const state: Workspaces = {
    list: [
      free("w0"),
      { ...free("w1"), project: "brand" as ProjectId },
      { id: "w2", columns: [], focus: 0 },
      free("w3"),
      bottom,
    ],
    current: 0,
  }
  const cells = cellsOf(pagerStateOf(state), [brand])
  expect(cells.map((cell) => cell.face.kind)).toEqual([
    "number",
    "sign",
    "number",
    "new",
  ])
  expect(cells[2]!.face).toEqual({ kind: "number", number: 4 })
  expect(cells[2]!.action).toBe("workspace.go-4")
})
