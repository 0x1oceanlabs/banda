import type { Listed } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { colourOf } from "./Lend"
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

test("a lent tab's chip takes its Agent's state colour, as a Group's plate", () => {
  expect(colourOf("running")).toBe("var(--working)")
  expect(colourOf("thinking")).toBe("var(--working)")
  expect(colourOf("asking")).toBe("var(--attention)")
  expect(colourOf("done")).toBe("var(--added)")
  expect(colourOf("failed")).toBe("var(--destructive)")
  expect(colourOf("rest")).toBe("var(--muted-foreground)")
})
