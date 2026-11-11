import type { ProjectId } from "@banda/contract"
import { beforeEach, expect, test, vi } from "vitest"

const said = vi.hoisted(() => ({ errors: [] as string[] }))
vi.mock("@banda/ui/components/sonner", () => ({
  toast: { error: (words: string) => void said.errors.push(words) },
}))

const { runLineOf } = await import("./run-line")

const PROJECT = "0196f000-0000-7000-8000-000000000021" as ProjectId

beforeEach(() => {
  said.errors.length = 0
})

test("Run in a Thread on arc asks the router for arc's terminal, with the Thread's Project and the line", () => {
  const run = vi.fn()
  runLineOf(run, PROJECT, "arc", undefined)!("hostname")
  expect(run.mock.calls).toEqual([
    ["terminal.run", { line: "hostname", project: PROJECT }],
  ])
  expect(said.errors).toEqual([])
})

test("Run while the Thread's machine is away is refused at once, in the words of an act not sent, and asks for no Pane", () => {
  const run = vi.fn()
  runLineOf(run, PROJECT, "arc", "arc is away")!("hostname")
  expect(run).not.toHaveBeenCalled()
  expect(said.errors).toEqual(["arc is away: Run was not sent."])
})

test("a Thread of this machine runs its line as ever, and with no window to run it a code block offers no Run", () => {
  const run = vi.fn()
  runLineOf(run, PROJECT, undefined, undefined)!("ls")
  expect(run).toHaveBeenCalledOnce()
  expect(runLineOf(undefined, PROJECT, "arc", undefined)).toBeNull()
})
