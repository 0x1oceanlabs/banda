import { expect, test } from "vitest"
import type { ListedThread } from "@banda/contract/agents"
import { waitsOn } from "./move-all"

const listed = (more: Partial<ListedThread>): ListedThread =>
  ({
    id: "t",
    harness: "work",
    title: "",
    updated_at: 0,
    asking: [],
    latest: {
      turn: "u",
      state: "failed",
      began: 0,
      failure: { class: "usage_limit" },
    },
    ...more,
  }) as ListedThread

test("a Thread waits on the account whose usage limit ended its latest turn", () => {
  expect(waitsOn(listed({}), "work")).toBe(true)
  expect(waitsOn(listed({}), "personal")).toBe(false)
  expect(waitsOn(listed({ archived: { at: 1 } as never }), "work")).toBe(false)
  const done = listed({ latest: { turn: "u", state: "done", began: 0 } })
  expect(waitsOn(done, "work")).toBe(false)
  const other = listed({
    latest: {
      turn: "u",
      state: "failed",
      began: 0,
      failure: { class: "provider" },
    },
  })
  expect(waitsOn(other, "work")).toBe(false)
})
