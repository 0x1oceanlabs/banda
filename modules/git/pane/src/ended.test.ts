import { showDetails } from "@banda/ui/components/thread-details"
import type { Args, WindowApi } from "@banda/ui/module"
import { afterEach, expect, test } from "vitest"
import { run } from "./chain"
import { keepWindow, toldOf } from "./ended"
import { fakeEngine } from "./testing"

/** A window that keeps what is told. */
function fakeWindow() {
  const told: Args[] = []
  const window = {
    run: (action: string, args?: Args) => {
      if (action === "notifications.tell" && args) told.push(args)
    },
  }
  return { window: window as unknown as WindowApi, told }
}

const stops: (() => void)[] = []
afterEach(() => {
  for (const stop of stops.splice(0)) stop()
})

test("a run says how it ended in a toast of its Space, a failure with why", () => {
  expect(
    toldOf("s", { is: "done", title: "Committed a1b", detail: "Add x" })
  ).toEqual({
    key: "git.s",
    in: "s",
    kind: "done",
    title: "Committed a1b",
    body: "Add x",
    buttons: [],
    silent: true,
  })
  expect(
    toldOf("s", { is: "failed", message: "Git could not push." }, "t")
  ).toEqual({
    key: "git.s",
    in: "s",
    about: "t",
    kind: "failed",
    title: "Git failed",
    body: "Git could not push.",
    buttons: [],
    close: true,
  })
})

test("the end of a run is told of its card's Thread, and of none with no card drawn", async () => {
  const { window, told } = fakeWindow()
  stops.push(keepWindow(window))
  const { engine, streams } = fakeEngine()
  const done = { kind: "done", done: { title: "Pushed a1b to origin/main" } }
  const writer = { name: "Claude", thread: "t" }

  // Asked from the card, the Thread's Agent hears each step from git.
  await run(engine, "s", writer, "push")
  expect(streams[0]!.params).toMatchObject({ action: "push", thread: "t" })
  ;(streams[0]!.onPiece as (piece: unknown) => void)(done)
  expect(told).toEqual([toldOf("s", { is: "done", ...done.done })])

  // The Thread's card drawn: the teller asks whether it is in sight.
  stops.push(showDetails("s", "t"))
  await run(engine, "s", writer, "pull")
  streams[1]!.onEnd({ code: "conflict", message: "Pull it first." })
  expect(told[1]).toEqual(
    toldOf("s", { is: "failed", message: "Pull it first." }, "t")
  )
})

test("a new Thread's card drawn says itself how a run ended", async () => {
  const { window, told } = fakeWindow()
  stops.push(keepWindow(window))
  const { engine, streams } = fakeEngine()
  stops.push(showDetails("n", null))
  await run(engine, "n", null, "push")
  ;(streams[0]!.onPiece as (piece: unknown) => void)({
    kind: "done",
    done: { title: "Pushed a1b to origin/main" },
  })
  expect(told).toEqual([])
})
