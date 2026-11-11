import { clock } from "@banda/core/react"
import { HOUR, MINUTE } from "@banda/ui/lib/words"
import type { Listed } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { type Choice, choicesOf, passedAt } from "./LaterPicker"
import { presets } from "./later-time"

/** Thursday 5 November 2026, 15:00, local time. */
const NOW = new Date(2026, 10, 5, 15, 0).getTime()

const thread = (more: Partial<Listed> = {}): Listed => ({
  id: "t1",
  title: "Bench window tests",
  mark: "done",
  changed: 0,
  pane: { kind: "agents.thread", args: { thread: "t1" } },
  ...more,
})

/** Each line's label, as the picker lists them for `listed`, one Thread
 * or several, with Banda's own presets but two. */
const labels = (
  listed: Listed | Listed[],
  more: { typed?: number; resets?: number } = {}
) =>
  choicesOf({
    targets: [listed].flat(),
    now: NOW,
    presets: presets(["1h", "tomorrow 9:00"], NOW),
    ...more,
  }).map((choice) => choice.label)

test("a Thread that asks may be put off: the presets, then Someday, set apart (ADR 0098, decision 11)", () => {
  const choices = choicesOf({
    targets: [thread({ mark: "asking" })],
    now: NOW,
    presets: presets(["1h"], NOW),
  })
  expect(choices).toEqual([
    {
      label: "In 1 hour",
      note: expect.any(String),
      picks: { until: NOW + HOUR },
    },
    { label: "Someday", note: "no time", picks: "someday", apart: true },
  ])
})

test("the first line follows where the Thread stands, so Enter alone picks it", () => {
  expect(labels(thread())).toEqual(["In 1 hour", "Tomorrow", "Someday"])
  expect(labels(thread({ mark: "working" }))).toEqual([
    "When it's done",
    "In 1 hour",
    "Tomorrow",
    "Someday",
  ])
  const sleeping = thread({ later: { at: 0, until: NOW + 2 * HOUR } })
  expect(labels(sleeping)).toEqual([
    "Wake now",
    "In 1 hour",
    "Tomorrow",
    "Someday",
  ])
  // A time typed comes before all of them.
  const typed = NOW + 45 * MINUTE
  expect(labels(sleeping, { typed })).toEqual([
    clock(typed, NOW),
    "Wake now",
    "In 1 hour",
    "Tomorrow",
    "Someday",
  ])
})

test("what a Thread already sleeps until is not offered again", () => {
  const someday = thread({ later: { at: 0, someday: true } })
  expect(labels(someday)).toEqual(["Wake now", "In 1 hour", "Tomorrow"])
  const whenDone = thread({ mark: "working", later: { at: 0 } })
  expect(labels(whenDone)).toEqual([
    "Wake now",
    "In 1 hour",
    "Tomorrow",
    "Someday",
  ])
  // Someday, at work: it may sleep until its turn ends instead.
  const working = thread({ mark: "working", later: { at: 0, someday: true } })
  expect(labels(working)).toEqual([
    "Wake now",
    "When it's done",
    "In 1 hour",
    "Tomorrow",
  ])
})

test("several Threads take one time: Wake now only if all of them sleep, When it's done only if all of them work (ADR 0098, decision 15)", () => {
  const sleeping = thread({ later: { at: 0, until: NOW + 2 * HOUR } })
  const working = thread({ mark: "working" })
  expect(labels([sleeping, sleeping])[0]).toBe("Wake now")
  expect(labels([sleeping, thread()])[0]).toBe("In 1 hour")
  expect(labels([working, working])[0]).toBe("When it's done")
  expect(labels([working, thread()])[0]).toBe("In 1 hour")
  // Someday is left out only where all of them sleep till Someday.
  const someday = thread({ later: { at: 0, someday: true } })
  expect(labels([someday, someday])).not.toContain("Someday")
  expect(labels([someday, sleeping])).toContain("Someday")
})

test("at its usage limit, the reset comes first, and its turn goes again then (ADR 0074, decision 8)", () => {
  const resets = NOW + 30 * MINUTE
  const choices = choicesOf({
    targets: [thread({ mark: "failed" })],
    now: NOW,
    presets: [],
    resets,
  })
  expect(choices[0]).toMatchObject({
    label: "When the limit resets",
    picks: { until: resets, resume: true },
  })
  // A reset that came already is no choice.
  expect(labels(thread({ mark: "failed" }), { resets: NOW - MINUTE })).toEqual([
    "In 1 hour",
    "Tomorrow",
    "Someday",
  ])
})

test("a time that passed while the picker was open is refused in place; the rest go", () => {
  const at = NOW + MINUTE
  const time: Choice = { label: "15:01", note: "", picks: { until: at } }
  expect(passedAt(time, NOW)).toBeUndefined()
  expect(passedAt(time, at)).toBe(at)
  expect(passedAt(time, at + 1)).toBe(at)
  const someday: Choice = { label: "Someday", note: "", picks: "someday" }
  expect(passedAt(someday, at + 1)).toBeUndefined()
})
