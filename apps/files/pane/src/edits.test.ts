import type { Touched } from "@banda/contract/agents"
import { expect, test } from "vitest"
import {
  heardWrites,
  lockedWhy,
  NAMED,
  taskBoxes,
  tickTask,
  writtenBy,
} from "./edits"

test("a file is edited only whole, as text, in its Pane, where Files may write", () => {
  const file = { mode: "pane" as const, binary: false, cut: false }
  expect(lockedWhy(file)).toBeNull()
  expect(lockedWhy({ ...file, mode: "quick" })).toMatch(/^Quick Look/)
  expect(lockedWhy({ ...file, binary: true })).toMatch(/binary/)
  expect(lockedWhy({ ...file, cut: true })).toMatch(/1 MB or 20,000 lines/)
  expect(lockedWhy({ ...file, locked: "git" })).toMatch(/\.git/)
  expect(lockedWhy({ ...file, locked: "settings" })).toMatch(/Settings/)
  expect(lockedWhy({ ...file, locked: "denied" })).toMatch(/may not be/)
})

const touch = (
  thread: string,
  path: string,
  kind: Touched["kind"] = "write"
): Touched => ({ thread, path, kind, at: 0 })

test("a change on disk is the Agent's while its turn writes the file, or for a moment after", () => {
  const paths = ["/work/src/util.ts", "src/util.ts"]
  const writing = [touch("t1", "/work/src/util.ts")]
  expect(writtenBy(writing, [], paths, 1_000)).toBe("t1")
  // Named from the Project's folder, as a Harness may.
  expect(writtenBy([touch("t2", "src/util.ts")], [], paths, 1_000)).toBe("t2")
  // A read is no write, nor is another file.
  expect(
    writtenBy([touch("t1", "/work/src/util.ts", "read")], [], paths, 1_000)
  ).toBeNull()
  expect(writtenBy([touch("t1", "/work/a.ts")], [], paths, 1_000)).toBeNull()

  // The turn goes on to another file: its write is kept as it left.
  const reading = [touch("t1", "/work/notes.md", "read")]
  const wrote = heardWrites([], writing, reading, 10_000)
  expect(wrote).toEqual([
    { path: "/work/src/util.ts", thread: "t1", left: 10_000 },
  ])
  expect(writtenBy(reading, wrote, paths, 10_000 + NAMED)).toBe("t1")
  expect(writtenBy(reading, wrote, paths, 10_001 + NAMED)).toBeNull()
  // A write still heard is not one that left.
  expect(heardWrites([], writing, writing, 10_000)).toEqual([])
  // Forgotten after a minute.
  expect(heardWrites(wrote, reading, reading, 70_001)).toEqual([])
})

test("a task's box is found at a list item's start, not in code", () => {
  const text = [
    "# Plan",
    "- [ ] one",
    "  * [x] two",
    "1. [X] three",
    "> - [ ] quoted",
    "- [] not a task",
    "-[ ] nor this",
    "```md",
    "- [ ] in code",
    "```",
    "+ [ ]",
  ].join("\n")
  const boxes = taskBoxes(text)
  expect(boxes.map((at) => text[at])).toEqual([" ", "x", "X", " ", " "])
  expect(boxes.map((at) => text.slice(at - 1, at + 2))).toEqual([
    "[ ]",
    "[x]",
    "[X]",
    "[ ]",
    "[ ]",
  ])
})

test("ticking a task writes its box and nothing else", () => {
  const text = "- [ ] one\n- [x] two\n"
  expect(tickTask(text, 0, true)).toBe("- [x] one\n- [x] two\n")
  expect(tickTask(text, 1, false)).toBe("- [ ] one\n- [ ] two\n")
  // Already so, or no such task.
  expect(tickTask(text, 1, true)).toBeNull()
  expect(tickTask(text, 2, true)).toBeNull()
  // Boxes shown that are not the tasks counted: nothing is written.
  expect(tickTask(text, 0, true, 0, 2)).toBe("- [x] one\n- [x] two\n")
  expect(tickTask(text, 0, true, 0, 3)).toBeNull()
  // After front matter, counted from where the body starts.
  const front = "---\nlist:\n- [ ] not a task\n---\n- [ ] task\n"
  const from = front.indexOf("- [ ] task")
  expect(tickTask(front, 0, true, from)).toBe(
    "---\nlist:\n- [ ] not a task\n---\n- [x] task\n"
  )
})
