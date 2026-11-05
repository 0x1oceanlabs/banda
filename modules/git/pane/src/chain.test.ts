import { expect, test } from "vitest"
import { LOST, run, runOf, stop, UNSAID } from "./chain"
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
    once: false,
  })
  const said = write!.onPiece as (piece: unknown) => void
  said({ kind: "reply", text: '{"subject": "Add the card"}' })
  await running
  expect(calls.map((call) => call.method)).toEqual([
    "git.prompt",
    "git.written",
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
