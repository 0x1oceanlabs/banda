import { expect, test } from "vitest"
import { Engine, type ProjectId, Unreachable } from "@banda/contract"
import type { Status } from "@banda/contract/git"
import { check, LOST, run, runOf, stop, UNSAID } from "./chain"
import { hearStatus } from "./status"
import { fakeEngine } from "./testing"

test("git.act is heard once: a broken connection does not push again", async () => {
  const { engine, streams } = fakeEngine()
  await run(engine, "lost", null, "push")
  const [act] = streams
  expect(act).toMatchObject({ method: "git.act", once: true })
  expect(runOf("lost").is).toBe("running")
  act!.onEnd({ code: "may_have_run", message: "gone" })
  expect(runOf("lost")).toEqual({ is: "failed", message: LOST })
})

test("a stream that ends unsaid fails the run, and one that said stays", async () => {
  const one = fakeEngine()
  await run(one.engine, "unsaid", null, "push")
  one.streams[0]!.onEnd()
  expect(runOf("unsaid")).toEqual({ is: "failed", message: UNSAID })

  const two = fakeEngine()
  await run(two.engine, "said", null, "push")
  const said = two.streams[0]!.onPiece as (piece: unknown) => void
  said({ kind: "done", done: { title: "Pushed" } })
  two.streams[0]!.onEnd()
  expect(runOf("said")).toMatchObject({ is: "done", title: "Pushed" })
})

const WRITER = { name: "Claude", thread: "t1" }
const ANSWERS = {
  "git.prompt": { prompt: "Write it" },
  "git.written": { message: "Add the card" },
}
/** Lets the run's awaits go on. */
const settled = () => new Promise((done) => setTimeout(done, 0))

test("the Harness writes the message, then git.act commits with it", async () => {
  const { engine, streams, calls } = fakeEngine(ANSWERS)
  const running = run(engine, "writes", WRITER, "commit")
  expect(runOf("writes")).toMatchObject({
    is: "running",
    label: "Claude is writing the message…",
    stops: true,
  })
  await settled()
  const [write] = streams
  expect(write).toMatchObject({
    method: "agents.write",
    params: { thread: "t1", prompt: "Write it" },
    // A reconnect never runs the writer again.
    once: true,
  })
  const said = write!.onPiece as (piece: unknown) => void
  said({ kind: "reply", text: '{"subject": "Add the card"}' })
  await running
  expect(calls).toMatchObject([
    // A press is one act: its reads go with it, and fail as it would.
    { method: "git.prompt", once: true },
    { method: "git.written", once: true },
  ])
  expect(streams[1]).toMatchObject({
    method: "git.act",
    params: { action: "commit", message: "Add the card" },
  })
  expect(runOf("writes")).toMatchObject({ is: "running", label: "Committing…" })
  expect(runOf("writes")).not.toHaveProperty("stops")
})

test("a new Thread's message is written by the Harness it starts on", async () => {
  const { engine, streams } = fakeEngine(ANSWERS)
  void run(engine, "fresh", { name: "Codex", harness: "codex" }, "commit")
  expect(runOf("fresh")).toMatchObject({
    label: "Codex is writing the message…",
  })
  await settled()
  expect(streams[0]!.params).toEqual({ harness: "codex", prompt: "Write it" })
})

test("Stop while the message is written ends the run quietly: the writer let go, nothing committed", async () => {
  const { engine, streams, calls } = fakeEngine(ANSWERS)
  const running = run(engine, "stops", WRITER, "commit_push")
  await settled()
  const [write] = streams
  stop("stops")
  await running
  expect(write!.stopped).toBe(true)
  expect(runOf("stops")).toEqual({ is: "idle" })
  expect(streams).toHaveLength(1)
  expect(calls.map((call) => call.method)).toEqual(["git.prompt"])
  // A reply that comes after changes nothing.
  ;(write!.onPiece as (piece: unknown) => void)({ kind: "reply", text: "x" })
  await settled()
  expect(runOf("stops")).toEqual({ is: "idle" })

  // Stopped before the prompt came back, no writer starts.
  const two = fakeEngine(ANSWERS)
  const early = run(two.engine, "early", WRITER, "commit")
  stop("early")
  await early
  expect(two.streams).toHaveLength(0)
  expect(runOf("early")).toEqual({ is: "idle" })
})

test("a writer that refuses fails the run with its words", async () => {
  const { engine, streams } = fakeEngine(ANSWERS)
  const running = run(engine, "refused", WRITER, "commit")
  await settled()
  const said = streams[0]!.onPiece as (piece: unknown) => void
  said({
    kind: "refused",
    refusal: { code: "conflict", message: "Claude Code wrote nothing." },
  })
  await running
  expect(runOf("refused")).toEqual({
    is: "failed",
    message: "Claude Code wrote nothing.",
  })
  // Stop does nothing once the run is not writing.
  stop("refused")
  expect(runOf("refused").is).toBe("failed")
})

test("the Person's own message needs no writer, and none can stop it", async () => {
  const { engine, streams } = fakeEngine(ANSWERS)
  await run(engine, "own", null, "commit", { message: "Mine" })
  expect(runOf("own")).toMatchObject({ is: "running", label: "Starting…" })
  expect(runOf("own")).not.toHaveProperty("stops")
  expect(streams[0]).toMatchObject({ method: "git.act" })
})

/** The Project's git as the card reads it: on `main`, its upstream one
 * commit behind it. */
const STATUS: Status = {
  at: 0,
  repo: true,
  branch: "main",
  head: "a1",
  upstream: "origin/main",
  ahead: 1,
  behind: 0,
  files: [],
  added: 0,
  removed: 0,
}

/** A run of `action` in `project` on an engine that watches its git, as
 * the card does, cut off on its way; what git says when asked after. */
async function cutOff(
  project: string,
  action: "commit" | "push" | "commit_push" | "pull",
  now: Partial<Status>
) {
  const { engine, streams, calls } = fakeEngine({
    "git.status": { ...STATUS, ...now },
  })
  hearStatus(engine, project as ProjectId, () => {})
  ;(streams[0]!.onPiece as (status: Status) => void)(STATUS)
  await run(engine, project, null, action, { message: "Add it" })
  const gone = new Unreachable("arc", "arc is away").sent()
  streams.at(-1)!.onEnd({ code: "may_have_run", message: "gone" }, gone)
  return { engine, calls }
}

test("cut off on its way a push may have gone through, and Check reads git again and says it did", async () => {
  const { engine, calls } = await cutOff("went", "push", { ahead: 0 })
  expect(runOf("went")).toMatchObject({
    is: "failed",
    message: "arc went away; Push may have gone through.",
    check: { action: "push", head: "a1" },
  })
  const checking = check(engine, "went")
  expect(runOf("went")).toMatchObject({ is: "running", label: "Checking…" })
  await checking
  // A read the Person asked: refused at once while arc is away.
  expect(calls).toEqual([{ method: "git.status", params: {}, once: true }])
  expect(runOf("went")).toEqual({ is: "done", title: "Push went through" })
})

test("Check on a push git still shows ahead says so, and can be pressed again", async () => {
  const { engine } = await cutOff("not-yet", "push", {})
  await check(engine, "not-yet")
  expect(runOf("not-yet")).toMatchObject({
    is: "failed",
    message: "Push has not gone through yet.",
    check: { action: "push", head: "a1" },
  })
})

test("Check knows a commit by its head, and a commit & push by both", async () => {
  const one = await cutOff("c-went", "commit", { head: "b2" })
  await check(one.engine, "c-went")
  expect(runOf("c-went")).toMatchObject({ title: "Commit went through" })

  const two = await cutOff("c-not", "commit", {})
  await check(two.engine, "c-not")
  expect(runOf("c-not")).toMatchObject({
    message: "Commit has not gone through yet.",
  })

  const three = await cutOff("cp-half", "commit_push", { head: "b2" })
  await check(three.engine, "cp-half")
  expect(runOf("cp-half")).toMatchObject({
    message: "Committed, but Push has not gone through yet.",
  })

  const four = await cutOff("cp-went", "commit_push", { head: "b2", ahead: 0 })
  await check(four.engine, "cp-went")
  expect(runOf("cp-went")).toMatchObject({
    title: "Commit & push went through",
  })

  const five = await cutOff("p-went", "pull", { behind: 0 })
  await check(five.engine, "p-went")
  expect(runOf("p-went")).toMatchObject({ title: "Pull went through" })
})

test("Check while arc is still away is refused at once, and stays to press again", async () => {
  await cutOff("away", "push", {})
  const arc = new Engine(() =>
    Promise.reject(new Unreachable("arc", "arc is away"))
  )
  await check(arc, "away")
  expect(runOf("away")).toMatchObject({
    is: "failed",
    message: "arc is away: Check was not sent.",
    check: { action: "push", head: "a1" },
  })
})

test("only a run cut off on its way offers Check", async () => {
  const { engine, streams } = fakeEngine()
  await run(engine, "refused-no-check", null, "push")
  streams[0]!.onEnd({ code: "conflict", message: "Pull first." })
  expect(runOf("refused-no-check")).toEqual({
    is: "failed",
    message: "Pull first.",
  })
  // With nothing to compare with, no status yet, it offers none either.
  const unknown = fakeEngine()
  await run(unknown.engine, "no-status", null, "push")
  unknown.streams[0]!.onEnd({ code: "may_have_run", message: "gone" })
  expect(runOf("no-status")).toEqual({ is: "failed", message: LOST })
  await check(engine, "refused-no-check")
  expect(runOf("refused-no-check")).toMatchObject({ is: "failed" })
})
