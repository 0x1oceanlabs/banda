import type { Listed } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { threadsIn } from "./threads"

const row = (id: string, changed: number, more: Partial<Listed> = {}) =>
  ({
    id,
    title: id,
    mark: "rest",
    changed,
    pane: { kind: "agents.thread", args: {} },
    ...more,
  }) as Listed

test("a tab is lent to a Thread of its Project, the latest first", () => {
  const rows = [
    row("vault redesign", 2, { agent: "a2", mark: "asking" }),
    // Another module's row about a Thread is no Thread to lend to.
    row("browser:7:a1", 9, { on: "a1", mark: "asking" }),
    row("fix login redirect", 4, { agent: "a1", mark: "running" }),
    row("e2e bar test", 1, { agent: "a3" }),
  ]
  expect(threadsIn(rows).map((each) => each.title)).toEqual([
    "fix login redirect",
    "vault redesign",
    "e2e bar test",
  ])
})
