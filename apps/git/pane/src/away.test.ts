/**
 * The Diff's and the git button's acts while the Project's machine is away
 * (ADR 0106, law 4): each is refused at once, in words that name the
 * machine and the act, and none waits to run once the machine is back.
 * The client is the window's own, whose machine never comes back here.
 */
import { Engine, type ProjectId, Unreachable } from "@banda/contract"
import { problem } from "@banda/ui/lib/words"
import { expect, test } from "vitest"
import { change } from "./change"
import { run, runOf } from "./chain"
import { NAMES } from "./stage"
import { fakeEngine } from "./testing"

/** The engine of arc, which is away: it is never reached. */
const arc = () =>
  new Engine(() => Promise.reject(new Unreachable("arc", "arc is away")))

/** A while: what waits for arc waits longer. */
const SOON = { timeout: 1_000 }

test("a hunk reverted in arc's Diff while arc is away is refused at once, naming arc and Revert", async () => {
  const reverted = change(arc(), "p" as ProjectId, "revert", {
    files: ["a.txt"],
  })
  const error: unknown = await reverted.catch((error: unknown) => error)
  expect(error).toBeInstanceOf(Unreachable)
  expect(error).toMatchObject({ may_have_run: false })
  expect(problem(error, NAMES.revert)).toBe("arc is away: Revert was not sent.")
})

test("a Commit clicked on arc's card while arc is away is refused whole and at once, its message's reads first", async () => {
  // The Harness writes its message: the reads before the writer refuse it.
  await run(arc(), "written", { name: "Claude", thread: "t1" }, "commit")
  expect(runOf("written")).toEqual({
    is: "failed",
    message: "arc is away: Commit was not sent.",
  })
  // The Person's own message, on a new branch: its one read refuses it.
  await run(arc(), "branched", null, "commit", {
    message: "Add the card",
    feature: true,
  })
  expect(runOf("branched")).toEqual({
    is: "failed",
    message: "arc is away: Commit was not sent.",
  })
  // No read at all: `git.act` itself is refused as it is asked.
  await run(arc(), "pushed", null, "commit_push", { message: "Add the card" })
  await expect
    .poll(() => runOf("pushed"), SOON)
    .toEqual({
      is: "failed",
      message: "arc is away: Commit & push was not sent.",
    })
}, 3_000)

test("a Commit cut off as arc goes may have gone through once git.act was asked, and was not sent while its message was being written", async () => {
  const gone = new Unreachable("arc", "arc is away").sent()
  const settled = () => new Promise((done) => setTimeout(done, 0))

  // git.act on its way: the commit may have run on arc.
  const acting = fakeEngine()
  await run(acting.engine, "acting", null, "commit", { message: "Add it" })
  acting.streams[0]!.onEnd({ code: "may_have_run", message: "gone" }, gone)
  expect(runOf("acting")).toEqual({
    is: "failed",
    message: "arc went away; Commit may have gone through.",
  })

  // The Harness writing the message as arc goes: nothing was committed.
  const writing = fakeEngine({ "git.prompt": { prompt: "Write it" } })
  const running = run(
    writing.engine,
    "writing",
    { name: "Claude", thread: "t1" },
    "commit"
  )
  await settled()
  const [writer] = writing.streams
  expect(writer).toMatchObject({ method: "agents.write" })
  writer!.onEnd({ code: "may_have_run", message: "gone" }, gone)
  await running
  expect(runOf("writing")).toEqual({
    is: "failed",
    message: "arc is away: Commit was not sent.",
  })
  expect(writing.streams).toHaveLength(1)
})
