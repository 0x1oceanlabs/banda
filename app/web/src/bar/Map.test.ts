import type { SpaceId } from "@banda/contract"
import { DEFAULT_COLUMNS } from "@banda/contract/look"
import type { Listed, PaneState } from "@banda/ui/pane"
import { expect, test } from "vitest"
import type { Workspace } from "../workspaces/model"
import { mapOf } from "./Map"

test("the map draws each column by its share, a Group's by its Agent's state", () => {
  const entry = (id: string) => ({
    id,
    space: "s" as SpaceId,
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
  const listed = (e: { id: string }) =>
    e.id === "a1"
      ? ({
          id: "t",
          title: "T",
          mark: "asking",
          changed: 0,
          agent: "x",
        } as Listed)
      : undefined
  expect(mapOf(workspace, DEFAULT_COLUMNS, listed)).toEqual([
    { id: "a", share: 0.5, group: "g", state: "asking", focused: false },
    { id: "b", share: 0.25, group: "g", state: "asking", focused: true },
    { id: "c", share: 0.25, focused: false },
  ])
})
