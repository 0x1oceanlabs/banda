import type { MarkState } from "@banda/ui/components/banda-mark"
import type { Listed } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { toggled } from "./archived"

const listed = (mark: MarkState, more: Partial<Listed> = {}): Listed => ({
  id: "t",
  title: "t",
  mark,
  changed: 1,
  pane: { kind: "agents.thread", args: { thread: "t" } },
  ...more,
})

test("Alt+S archives a row, brings back an archived one, and leaves one at work", () => {
  const lists = {
    p: [
      listed("done", { id: "a" }),
      listed("rest", { id: "b", archived: true }),
      listed("running", { id: "c" }),
    ],
  }
  expect(toggled(lists, "p" as never, "a")).toBe(true)
  expect(toggled(lists, "p" as never, "b")).toBe(false)
  expect(toggled(lists, "p" as never, "c")).toBeUndefined()
  expect(toggled(lists, "p" as never, "gone")).toBeUndefined()
})
