import type { ProjectId } from "@banda/contract"
import { DEFAULT_COLUMNS } from "@banda/contract/look"
import type { PaneState } from "@banda/ui/pane"
import { expect, test } from "vitest"
import type { Workspace } from "./model"
import { mapOf } from "./Map"

test("the map draws each column by its share, a Group's by its owner's state", () => {
  const entry = (id: string) => ({
    id,
    project: "s" as ProjectId,
    pane: { kind: "a.a", args: {} } as PaneState,
  })
  const workspace: Workspace = {
    id: "w",
    focus: 1,
    columns: [
      { id: "a", entries: [entry("a1")], active: 0, width: "1/2", group: "g" },
      { id: "b", entries: [entry("b1")], active: 0, width: "1/4", group: "g" },
      { id: "c", entries: [entry("c1")], active: 0, width: "1/4" },
    ],
  }
  const groups = new Map([["g", { state: "asking" as const, name: "T" }]])
  expect(mapOf(workspace, DEFAULT_COLUMNS, groups)).toEqual([
    { id: "a", share: 0.5, group: "g", state: "asking", focused: false },
    { id: "b", share: 0.25, group: "g", state: "asking", focused: true },
    { id: "c", share: 0.25, focused: false },
  ])
  // A Group no one owns has no state.
  expect(mapOf(workspace, DEFAULT_COLUMNS, new Map())[0]).toEqual({
    id: "a",
    share: 0.5,
    group: "g",
    state: undefined,
    focused: false,
  })
})
