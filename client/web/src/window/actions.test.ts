import type { PaneState } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { entries, open, start } from "../tiling/model"
import { closingShown, opening, updating } from "./actions"

const thread = (id: string): PaneState => ({
  kind: "agents.thread",
  args: { thread: id },
})

test("an archived Thread's Pane closes, and only its own", () => {
  const right = { place: "right" } as const
  let state = start()
  state = open(state, "project-a", thread("t1"), right)
  state = open(state, "project-a", thread("t2"), right)
  state = open(state, "project-b", thread("t1"), right)
  const [, second] = entries(state)

  expect(closingShown(state, { project: "project-a", about: "t2" })).toEqual({
    command: { method: "workspaces.close", params: { pane: second!.id } },
  })
  // No Pane shows it: nothing to close.
  expect(
    closingShown(state, { project: "project-a", about: "t3" })
  ).toBeUndefined()
  expect(
    closingShown(state, { project: "project-c", about: "t1" })
  ).toBeUndefined()
})

test("a Thread opens as a Group, and a Pane of another kind in none", () => {
  const params = (pane: PaneState) => {
    const plan = opening(start(), "project-a", pane, { place: "right" })
    return plan && "command" in plan ? plan.command.params : undefined
  }
  expect(params(thread("t1"))).toMatchObject({ grouped: true })
  const diff = { kind: "git.diff", args: { scope: { kind: "changes" } } }
  expect(params(diff)).not.toHaveProperty("grouped")
})

test("opened to update, a Pane shown as its kind names it takes the new args, and the focus", () => {
  const diff = (scope: string): PaneState => ({
    kind: "git.diff",
    args: { scope: { kind: scope }, file: null },
  })
  const state = open(start(), "project-a", diff("changes"), { place: "right" })
  const [shown] = entries(state)

  // The Project's one Diff, as its kind names it, with another scope.
  expect(updating(state, "project-a", diff("staged"))).toEqual({
    command: {
      method: "workspaces.update",
      params: { pane: shown!.id, args: diff("staged").args },
    },
    want: shown!.id,
  })
  // The same args: only the focus.
  const same = updating(state, "project-a", diff("changes"))
  expect(entries(same as typeof state)).toEqual(entries(state))
  // None shown in that Project: it opens.
  expect(updating(state, "project-b", diff("staged"))).toMatchObject({
    command: { method: "workspaces.open" },
  })
})
