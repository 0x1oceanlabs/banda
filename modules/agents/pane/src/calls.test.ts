import { expect, test } from "vitest"
import { outcome, said } from "./calls"
import type { Tool } from "./thread"

const call = (title: string, over: Partial<Tool> = {}): Tool => ({
  kind: "tool",
  title,
  tool: "execute",
  status: "done",
  content: [],
  ...over,
})

test("a call says its verb in the tense of how it stands, and what it acted on", () => {
  const command = call("pnpm vitest writer")
  expect(said(command, "done")).toEqual({
    verb: "Ran",
    subject: "pnpm vitest writer",
  })
  expect(said(command, "running")).toEqual({
    verb: "Running",
    subject: "pnpm vitest writer",
  })
  expect(said(command, "waiting")).toEqual({
    verb: "Run",
    subject: "pnpm vitest writer",
  })
  // The verb a Harness gave its title becomes the line's.
  expect(said(call("Run the tests"), "done").verb).toBe("Ran")
  expect(
    said(call("Read settings/src/writer.ts", { tool: "read" }), "done")
  ).toEqual({ verb: "Read", subject: "settings/src/writer.ts" })
  expect(said(call("Edit `writer.ts`", { tool: "edit" }), "done")).toEqual({
    verb: "Edited",
    subject: "writer.ts",
  })
  expect(
    said(call('Search "writeFile" in settings/', { tool: "search" }), "done")
  ).toEqual({ verb: "Searched for", subject: '"writeFile" in settings/' })
})

test("a call that made its file says it created it", () => {
  const made = call("Write lock.ts", {
    tool: "edit",
    content: [{ kind: "diff", path: "lock.ts", new: "x\n" }],
  })
  expect(said(made, "done")).toEqual({ verb: "Created", subject: "lock.ts" })
  const kept = call("Write lock.ts", {
    tool: "edit",
    content: [{ kind: "diff", path: "lock.ts", old: "y\n", new: "x\n" }],
  })
  expect(said(kept, "done").verb).toBe("Wrote")
})

test("a title with no verb Banda knows says itself; a command's always runs", () => {
  expect(said(call("Screenshot result", { tool: "fetch" }), "done")).toEqual({
    subject: "Screenshot result",
  })
  // "find" leads a command, not a search.
  expect(said(call("find . -name '*.ts'"), "done")).toEqual({
    verb: "Ran",
    subject: "find . -name '*.ts'",
  })
  expect(said(call("`ls -la`"), "done").subject).toBe("ls -la")
})

test("a call fails by its status or its exit code; a signal or a stop stops it", () => {
  expect(outcome(call("x"))).toBe("done")
  expect(outcome(call("x", { status: "failed" }))).toBe("failed")
  expect(
    outcome(call("x", { output: { text: "", exit: { code: 1 }, cut: false } }))
  ).toBe("failed")
  expect(
    outcome(
      call("x", {
        status: "failed",
        output: { text: "", exit: { signal: "SIGTERM" }, cut: false },
      })
    )
  ).toBe("stopped")
  // Its Person stopped the turn while it ran.
  expect(outcome(call("x", { status: "failed" }), "stopped")).toBe("stopped")
  expect(outcome(call("x", { status: "running" }), "stopped")).toBe("stopped")
  expect(outcome(call("x", { status: "running" }), "done")).toBe("done")
})

test("a call that has not started waits for its Person only while asked", () => {
  const pending = call("x", { status: "pending" })
  expect(outcome(pending, "running", true)).toBe("waiting")
  expect(outcome(pending, "running")).toBe("running")
  expect(outcome(call("x", { status: "running" }), "running", true)).toBe(
    "running"
  )
})
