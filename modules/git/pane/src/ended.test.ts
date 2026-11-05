import type { Args, Sight, WindowApi } from "@banda/ui/module"
import { afterEach, expect, test } from "vitest"
import { run } from "./chain"
import { cardShown, inSight, keepWindow, toldOf } from "./ended"
import { fakeEngine } from "./testing"

/** A window whose Person looks as `sight` says, which keeps what is
 * told. */
function fakeWindow(sight: (thing?: { about: string }) => Sight) {
  const told: Args[] = []
  const window = {
    sight,
    spaces: () => [{ id: "s", name: "Work" }],
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

test("a card is in sight while its Thread's Pane is on screen and the window in front", () => {
  const away = () => "away" as const
  const at = (about: string) => (thing?: { about: string }) =>
    thing?.about === about ? ("on-screen" as const) : ("in-window" as const)
  expect(inSight("s", [], at("t"))).toBe(false)
  expect(inSight("s", ["t"], at("t"))).toBe(true)
  expect(inSight("s", ["u"], at("t"))).toBe(false)
  expect(inSight("s", ["t"], away)).toBe(false)
  // A new Thread's, which no Pane names yet: the window in front.
  expect(inSight("s", [null], at("t"))).toBe(true)
  expect(inSight("s", [null], away)).toBe(false)
})

test("a run says how it ended in a toast of its Space, a failure with why", () => {
  expect(
    toldOf("s", { is: "done", title: "Committed a1b", detail: "Add x" })
  ).toEqual({
    key: "git.s",
    kind: "done",
    title: "Committed a1b",
    body: "Add x",
    buttons: [],
    silent: true,
  })
  expect(
    toldOf("s", { is: "failed", message: "Git could not push." }, "Work")
  ).toEqual({
    key: "git.s",
    kind: "failed",
    title: "Git failed",
    body: "Git could not push.",
    space: "Work",
    buttons: [],
    close: true,
  })
})

test("a commit from the card tells its Thread's Agent, and a toast only when no card is in sight", async () => {
  const shown = { now: "on-screen" as Sight }
  const { window, told } = fakeWindow(() => shown.now)
  stops.push(keepWindow(window))
  const { engine, streams, commands } = fakeEngine()
  stops.push(cardShown("s", "t"))
  const done = {
    kind: "done",
    done: {
      title: "Committed and pushed a1b to origin/main",
      detail: "Add x",
      notice:
        "Committed 1 file on main: “Add x” (a1b), and pushed it to origin/main.",
    },
  }

  const writer = { name: "Claude", thread: "t" }
  await run(engine, "s", writer, "push")
  ;(streams[0]!.onPiece as (piece: unknown) => void)(done)
  expect(commands).toEqual([
    {
      method: "agents.notice",
      params: { thread: "t", text: done.done.notice },
      space: "s",
    },
  ])
  expect(told).toEqual([])

  // The Thread off screen: the card says nothing the Person sees.
  shown.now = "in-window"
  await run(engine, "s", writer, "pull")
  streams[1]!.onEnd({ code: "conflict", message: "Pull it first." })
  expect(told).toEqual([
    toldOf("s", { is: "failed", message: "Pull it first." }),
  ])
  expect(commands).toHaveLength(1)
})

test("with no card drawn, the end of a run is told", async () => {
  const { window, told } = fakeWindow(() => "looking")
  stops.push(keepWindow(window))
  const { engine, streams } = fakeEngine()
  const hidden = cardShown("h", "t")
  hidden()
  await run(engine, "h", null, "push")
  ;(streams[0]!.onPiece as (piece: unknown) => void)({
    kind: "done",
    done: { title: "Pushed a1b to origin/main" },
  })
  expect(told.map((each) => each.title)).toEqual(["Pushed a1b to origin/main"])
})
