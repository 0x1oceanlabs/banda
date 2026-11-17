/**
 * What `engine.ts` does of its own, beside the model it asks
 * (`parity.test.ts` holds that the model is the engine's): what the model
 * cannot read is no fault the Person sees.
 */
import type { Workspace } from "@banda/contract/workspaces"
import { expect, test, vi } from "vitest"
import { apply, type Command, NO_FACTS, refusalFor, refusedTo } from "./engine"
import { uid } from "./testing"

/** A window's arrangement while it waits for the engine's: its one
 * workspace has no ID yet. */
const WAITING = [{ id: "", columns: [] }] as unknown as Workspace[]

const moved: Command = {
  method: "workspaces.move_pane",
  params: {
    pane: uid("pane"),
    place: { to: "column", workspace: uid("w"), index: 0 },
  },
}

test("over an arrangement the model cannot read the window foresees nothing, and a command draws nothing", () => {
  const warned = vi.spyOn(console, "warn").mockImplementation(() => {})
  const row = { ...NO_FACTS, flow: "row" } as const
  expect(refusalFor(WAITING, moved, row)).toBeUndefined()
  expect(refusedTo(WAITING, row, uid("pane"), false).size).toBe(0)
  expect(warned).toHaveBeenCalledTimes(2)
  warned.mockRestore()
  expect(apply(WAITING, moved, uid("seed"))).toMatchObject({
    refused: "invalid",
  })
})

test("a command the model reads and refuses comes back in the engine's words", () => {
  const list = [{ id: uid("w"), columns: [] }] as unknown as Workspace[]
  expect(apply(list, moved, uid("seed"))).toMatchObject({
    refused: "not_found",
  })
})
