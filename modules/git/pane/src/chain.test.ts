import { expect, test } from "vitest"
import { LOST, run, runOf, UNSAID } from "./chain"
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
