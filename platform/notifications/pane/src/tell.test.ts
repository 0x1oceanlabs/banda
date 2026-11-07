import type { Call } from "@banda/ui/pane"
import type { Chime } from "@banda/ui/sound"
import type { Notify } from "@banda/contract/look"
import { expect, test } from "vitest"
import { lookedAt, newsOf, tell } from "./tell"

const NOTIFY: Notify = {
  system: "away",
  window: "out-of-sight",
  detail: true,
  quiet: "desktop",
  done: true,
  asking: true,
  failed: true,
  problems: true,
}

const call = (about: string, chime: Chime): Call => ({
  key: `s:${about}`,
  project: "s",
  about,
  chime,
  title: about,
  pane: { kind: "agents.thread", args: { thread: about } },
  since: 0,
})

test("a thing that starts calling, or calls another way, is news", () => {
  const before = [call("t1", "done"), call("t2", "asking")]
  const now = [call("t2", "failed"), call("t3", "done")]
  const { fresh, gone } = newsOf(before, now)
  expect(fresh.map((c) => c.about)).toEqual(["t2", "t3"])
  expect(gone.map((c) => c.about)).toEqual(["t1"])
  expect(newsOf(now, now)).toEqual({ fresh: [], gone: [] })
})

test("the first list is what already was: no news", () => {
  expect(newsOf(undefined, [call("t1", "asking")])).toEqual({
    fresh: [],
    gone: [],
  })
})

test("only the focused Pane's thing is asked whether the Person looks at it, so what shows is never measured for it", () => {
  const calling = [call("t1", "done"), call("t2", "asking"), call("t3", "done")]
  const asked: string[] = []
  const sight = (looking: boolean) => (one: Call) => {
    asked.push(one.about)
    return looking ? ("looking" as const) : ("away" as const)
  }
  const at = { project: "s", shows: "t2" }
  expect(lookedAt(calling, at, sight(true)).map((c) => c.about)).toEqual(["t2"])
  // The window behind: the focused Pane is not looked at.
  expect(lookedAt(calling, at, sight(false))).toEqual([])
  // No Pane focused, one that shows no thing, or one of another Project.
  expect(lookedAt(calling, null, sight(true))).toEqual([])
  expect(lookedAt(calling, { project: "s" }, sight(true))).toEqual([])
  expect(
    lookedAt(calling, { project: "other", shows: "t2" }, sight(true))
  ).toEqual([])
  expect(asked).toEqual(["t2", "t2"])
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
