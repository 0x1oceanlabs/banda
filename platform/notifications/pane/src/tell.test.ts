import type { Call } from "@banda/ui/pane"
import { type Chime, DEFAULT_SOUND } from "@banda/ui/sound"
import type { Notify } from "@banda/contract/look"
import { expect, test } from "vitest"
import { lookedAt, newsOf, placeOf, silentWith, tell } from "./tell"

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

/** Neither Banda's Quiet nor the desktop's Do Not Disturb is on. */
const LOUD = { banda: false, desktop: false }
const DESKTOP_QUIET = { banda: false, desktop: true }

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

test("the Person looks at the thing the Pane in focus shows, the Window in front", () => {
  const calling = [call("t1", "done"), call("t2", "asking"), call("t3", "done")]
  const pane = { id: "p", project: "s", subject: "t2" }
  expect(lookedAt(calling, { front: true, pane }).map((c) => c.about)).toEqual([
    "t2",
  ])
  // The Window behind: the Pane in focus is not looked at.
  expect(lookedAt(calling, { front: false, pane })).toEqual([])
  // No Pane in focus, one that shows no thing, or one of another Project.
  expect(lookedAt(calling, { front: true, pane: null })).toEqual([])
  expect(
    lookedAt(calling, { front: true, pane: { id: "p", project: "s" } })
  ).toEqual([])
  expect(
    lookedAt(calling, { front: true, pane: { ...pane, project: "other" } })
  ).toEqual([])
})

test("a call is told once, where the Person will notice it", () => {
  const said = (sight: Parameters<typeof tell>[1]) =>
    tell("done", sight, NOTIFY, LOUD)
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
  expect(tell("asking", "away", NOTIFY, DESKTOP_QUIET)).toEqual({
    sound: false,
    toast: false,
    system: false,
  })
  const never = { ...NOTIFY, quiet: "never" as const }
  expect(tell("asking", "away", never, DESKTOP_QUIET).system).toBe(true)
})

// ADR 0098, decision 21: while Banda's Quiet is on nothing is told, a
// module's news neither, wherever the Person is and whatever the desktop
// and [notify] say.
test("Banda's Quiet tells nothing: no sound, no toast, no notice", () => {
  const quiet = { banda: true, desktop: false }
  const always = {
    ...NOTIFY,
    system: "always" as const,
    quiet: "never" as const,
  }
  for (const sight of ["on-screen", "in-window", "away"] as const)
    for (const settings of [NOTIFY, always])
      for (const chime of ["done", "asking", "failed"] as const)
        expect(tell(chime, sight, settings, quiet, true)).toEqual({
          sound: false,
          toast: false,
          system: false,
        })
  expect(placeOf("away", always, quiet)).toBeNull()
  expect(placeOf("away", always, { banda: true, desktop: true })).toBeNull()
  // Off, the same call is told again.
  expect(tell("asking", "in-window", NOTIFY, LOUD).toast).toBe(true)
})

test("a desktop notice that sounds by itself, as Windows' does, carries the call's sound; a toast keeps Banda's", () => {
  expect(tell("done", "away", NOTIFY, LOUD, true)).toEqual({
    sound: false,
    toast: false,
    system: true,
  })
  expect(tell("done", "in-window", NOTIFY, LOUD, true)).toEqual({
    sound: true,
    toast: true,
    system: false,
  })
  // With no notice of its kind, Banda's sound tells of it alone.
  expect(tell("done", "away", { ...NOTIFY, done: false }, LOUD, true)).toEqual({
    sound: true,
    toast: false,
    system: false,
  })
})

test("a notice is silent where [sound] gives its call none, or what told it asked for none", () => {
  expect(silentWith(DEFAULT_SOUND, "done")).toBe(false)
  expect(silentWith(DEFAULT_SOUND, "done", true)).toBe(true)
  expect(silentWith({ ...DEFAULT_SOUND, volume: 0 }, "asking")).toBe(true)
  expect(silentWith({ ...DEFAULT_SOUND, family: "off" }, "failed")).toBe(true)
  expect(silentWith({ ...DEFAULT_SOUND, done: false }, "done")).toBe(true)
  expect(silentWith({ ...DEFAULT_SOUND, done: false }, "asking")).toBe(false)
})

test("every variant of [notify] says where", () => {
  const off = { ...NOTIFY, system: "off" as const, window: "off" as const }
  expect(tell("failed", "away", off, LOUD)).toEqual({
    sound: true,
    toast: false,
    system: false,
  })
  const always = { ...NOTIFY, system: "always" as const }
  // A system notification, so no toast: never in two places.
  expect(tell("done", "in-window", always, LOUD)).toEqual({
    sound: true,
    toast: false,
    system: true,
  })
  const toasts = { ...NOTIFY, window: "always" as const }
  expect(tell("done", "on-screen", toasts, LOUD).toast).toBe(true)
  const noDone = { ...NOTIFY, done: false }
  expect(tell("done", "away", noDone, LOUD)).toEqual({
    sound: true,
    toast: false,
    system: false,
  })
})
