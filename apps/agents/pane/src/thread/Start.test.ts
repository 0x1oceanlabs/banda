import { describe, expect, test } from "vitest"
import type { ListedThread } from "@banda/contract/agents"
import { recentOf } from "./Start"

const thread = (
  id: string,
  updated_at: number,
  more: Partial<ListedThread> = {}
): ListedThread =>
  ({
    id,
    title: id,
    harness: "fake",
    agent: "fake",
    asking: [],
    updated_at,
    ...more,
  }) as ListedThread

describe("recentOf", () => {
  test("the latest three Threads, none archived or a sub-agent's", () => {
    const { shown, count } = recentOf([
      thread("a", 1),
      thread("b", 5),
      thread("old", 0),
      thread("c", 3),
      thread("gone", 9, { archived: { at: 9 } as ListedThread["archived"] }),
      thread("sub", 8, { parent: "b" as ListedThread["parent"] }),
    ])
    expect(shown.map((one) => one.id)).toEqual(["b", "c", "a"])
    expect(count).toBe(4)
  })
})
