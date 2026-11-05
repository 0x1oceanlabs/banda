import type { PaneState } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { entries, open, start } from "../workspaces/model"
import { closingShown } from "./actions"

const thread = (id: string): PaneState => ({
  kind: "agents.thread",
  args: { thread: id },
})

test("an archived Thread's Pane closes, and only its own", () => {
  const right = { place: "right" } as const
  let state = start()
  state = open(state, "space-a", thread("t1"), right)
  state = open(state, "space-a", thread("t2"), right)
  state = open(state, "space-b", thread("t1"), right)
  const [, second] = entries(state)

  expect(closingShown(state, { space: "space-a", about: "t2" })).toEqual({
    command: { method: "workspaces.close", params: { pane: second!.id } },
  })
  // No Pane shows it: nothing to close.
  expect(closingShown(state, { space: "space-a", about: "t3" })).toBeUndefined()
  expect(closingShown(state, { space: "space-c", about: "t1" })).toBeUndefined()
})
