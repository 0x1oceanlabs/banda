import type { MarkState } from "@banda/ui/components/banda-mark"
import type { Listed } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { archivable, isArchived, toggled } from "./archived"

const listed = (mark: MarkState, more: Partial<Listed> = {}): Listed => ({
  id: "t",
  title: "t",
  mark,
  changed: 1,
  pane: { kind: "agents.thread", args: { thread: "t" } },
  ...more,
})

test("a Thread is archived as its App lists it from its host, and nothing else archives it", () => {
  expect(isArchived(listed("rest", { archived: true }))).toBe(true)
  // Quiet for days, or put off: only its host's mark archives it.
  expect(isArchived(listed("rest", { changed: 0 }))).toBe(false)
  expect(isArchived(listed("done", { later: { at: 0, until: 9 } }))).toBe(false)
})

test("work going on, or a question, cannot be archived", () => {
  expect(archivable(listed("running"))).toBe(false)
  expect(archivable(listed("asking"))).toBe(false)
  expect(archivable(listed("done"))).toBe(true)
  expect(archivable(listed("rest"))).toBe(true)
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
