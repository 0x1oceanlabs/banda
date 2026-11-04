import type { Engine, Refusal } from "@banda/contract"
import { expect, test } from "vitest"
import { LOST, run, runOf, UNSAID } from "./chain"

/** An engine whose `git.act` stream the test ends by hand. */
function engine() {
  const heard: {
    onPiece?: (piece: unknown) => void
    onEnd?: (refusal?: Refusal) => void
    once?: boolean
  } = {}
  const fake = {
    stream: (
      _space: string,
      _method: string,
      _params: unknown,
      onPiece: (piece: unknown) => void,
      onEnd: (refusal?: Refusal) => void,
      how?: { once?: boolean }
    ) => {
      Object.assign(heard, { onPiece, onEnd, once: how?.once })
      return () => {}
    },
  }
  return { engine: fake as unknown as Engine, heard }
}

test("git.act is heard once: a broken connection does not push again", async () => {
  const { engine: one, heard } = engine()
  await run(one, "lost", null, "push")
  expect(heard.once).toBe(true)
  expect(runOf("lost").is).toBe("running")
  heard.onEnd!({ code: "may_have_run", message: "gone" })
  expect(runOf("lost")).toEqual({ is: "failed", message: LOST })
})

test("a stream that ends unsaid fails the run, and one that said stays", async () => {
  const { engine: one, heard } = engine()
  await run(one, "unsaid", null, "push")
  heard.onEnd!()
  expect(runOf("unsaid")).toEqual({ is: "failed", message: UNSAID })

  const { engine: two, heard: said } = engine()
  await run(two, "said", null, "push")
  said.onPiece!({ kind: "done", done: { title: "Pushed" } })
  said.onEnd!()
  expect(runOf("said")).toMatchObject({ is: "done", title: "Pushed" })
})
