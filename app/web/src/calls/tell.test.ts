import type { Listed } from "@banda/ui/pane"
import type { Chime } from "@banda/ui/sound"
import { expect, test } from "vitest"
import { open, start } from "../workspaces/model"
import { DEFAULT_NOTIFY as NOTIFY } from "./settings"
import { type Shows, showing, sightOf } from "./sight"
import { type Call, callsOf, newsOf, tell } from "./tell"
import { alive, LIFE, released, told } from "./toasts"
import { first, type Heard } from "./useCalls"

const call = (about: string, chime: Chime): Call => ({
  about,
  chime,
  title: about,
  pane: { kind: "agents.thread", args: { thread: about } },
})

test("a thing that starts calling, or calls another way, is news", () => {
  const before = [call("t1", "done"), call("t2", "asking")]
  const now = [call("t2", "failed"), call("t3", "done")]
  const { fresh, gone } = newsOf(before, now)
  expect(fresh.map((c) => c.about)).toEqual(["t2", "t3"])
  expect(gone.map((c) => c.about)).toEqual(["t1"])
  expect(newsOf(now, now)).toEqual({ fresh: [], gone: [] })
})

test("what asks, failed or finished unseen calls, with what it said", () => {
  const thing = (id: string, mark: Listed["mark"], more = {}): Listed => ({
    id,
    title: id,
    mark,
    changed: 1,
    pane: call(id, "done").pane,
    ...more,
  })
  const calls = callsOf([
    thing("t1", "running"),
    thing("t2", "asking", { calls: "Run it?", said: "fix it" }),
    thing("t3", "done", { said: "fix the tests" }),
    thing("t4", "rest"),
    thing("t5", "failed"),
  ])
  expect(calls.map((c) => [c.about, c.chime, c.detail])).toEqual([
    ["t2", "asking", "Run it?"],
    ["t3", "done", "fix the tests"],
    ["t5", "failed", undefined],
  ])
})

test("the first list is what already was: no news", () => {
  expect(newsOf(undefined, [call("t1", "asking")])).toEqual({
    fresh: [],
    gone: [],
  })
})

test("a call is told once, where the Person will notice it", () => {
  const said = (sight: Parameters<typeof tell>[1]) =>
    tell("done", sight, NOTIFY, false)
  expect(said("looking")).toEqual({ sound: false, toast: false, system: false })
  expect(said("on-screen")).toEqual({
    sound: true,
    toast: false,
    system: false,
  })
  expect(said("in-window")).toEqual({ sound: true, toast: true, system: false })
  expect(said("away")).toEqual({ sound: true, toast: false, system: true })
})

test("the desktop's quiet leaves only the Marks, unless told never", () => {
  expect(tell("asking", "away", NOTIFY, true)).toEqual({
    sound: false,
    toast: false,
    system: false,
  })
  const never = { ...NOTIFY, quiet: "never" as const }
  expect(tell("asking", "away", never, true).system).toBe(true)
})

test("every variant of [notify] says where", () => {
  const off = { ...NOTIFY, system: "off" as const, window: "off" as const }
  expect(tell("failed", "away", off, false)).toEqual({
    sound: true,
    toast: false,
    system: false,
  })
  const always = { ...NOTIFY, system: "always" as const }
  // A system notification, so no toast: never in two places.
  expect(tell("done", "in-window", always, false)).toEqual({
    sound: true,
    toast: false,
    system: true,
  })
  const toasts = { ...NOTIFY, window: "always" as const }
  expect(tell("done", "on-screen", toasts, false).toast).toBe(true)
  const noDone = { ...NOTIFY, done: false }
  expect(tell("done", "away", noDone, false)).toEqual({
    sound: true,
    toast: false,
    system: false,
  })
})

test("the Person looks at the focused Pane of the window in front", () => {
  const shows: Shows = (pane) => (pane.args.thread as string) ?? null
  const w = open(
    open(start(), "s", call("t1", "done").pane),
    "s",
    call("t2", "done").pane,
    { place: "right" }
  )
  expect(sightOf(w, { space: "s", about: "t2" }, true, shows)).toBe("looking")
  expect(sightOf(w, { space: "s", about: "t1" }, true, shows)).toBe("on-screen")
  expect(sightOf(w, { space: "s", about: "t3" }, true, shows)).toBe("in-window")
  expect(sightOf(w, { space: "other", about: "t2" }, true, shows)).toBe(
    "in-window"
  )
  expect(sightOf(w, { space: "s", about: "t2" }, false, shows)).toBe("away")
  expect(showing(w, { space: "s", about: "t1" }, shows)?.pane.args).toEqual({
    thread: "t1",
  })
})

test("a toast goes away by itself; a new call of its thing replaces it", () => {
  let toasts = told([], "a", "done", 0)
  toasts = told(toasts, "b", "asking", 1000)
  toasts = told(toasts, "a", "failed", 2000)
  expect(toasts.map((t) => t.key)).toEqual(["a", "b"])
  expect(alive(toasts, 2000 + LIFE.failed).map((t) => t.key)).toEqual(["b"])
  // Held for 10 s, let go: none went away meanwhile.
  const held = released(toasts, 10_000, 20_000)
  expect(alive(held, 20_000 + 1000).length).toBe(2)
})

test("Alt+U answers the loudest call first, then the one that called first", () => {
  const heard = (about: string, chime: Chime, since: number): Heard => ({
    ...call(about, chime),
    key: `s:${about}`,
    space: "s",
    since,
  })
  const calling = [
    heard("t1", "done", 1),
    heard("t2", "asking", 3),
    heard("t3", "asking", 2),
  ]
  expect(first(calling)?.about).toBe("t3")
  expect(first([heard("t1", "done", 1), heard("t4", "failed", 9)])?.about).toBe(
    "t4"
  )
  expect(first([])).toBeUndefined()
})
