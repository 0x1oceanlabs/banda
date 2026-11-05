import { expect, test } from "vitest"
import { callsOf, type Listed } from "./pane"

const pane = { kind: "agents.thread", args: {} }

test("what asks, failed or finished unseen calls, with what it said", () => {
  const thing = (id: string, mark: Listed["mark"], more = {}): Listed => ({
    id,
    title: id,
    mark,
    changed: 1,
    pane,
    ...more,
  })
  const calls = callsOf({
    s: [
      thing("t1", "running"),
      thing("t2", "asking", { calls: "Run it?", said: "fix it" }),
      thing("t3", "done", { said: "fix the tests" }),
      thing("t4", "rest"),
      thing("t5", "failed"),
    ],
  })
  expect(calls.map((c) => [c.about, c.chime, c.detail])).toEqual([
    ["t2", "asking", "Run it?"],
    ["t3", "done", "fix the tests"],
    ["t5", "failed", undefined],
  ])
  expect(calls[0]).toMatchObject({ key: "s:t2", project: "s", since: 1 })
})
