import type { Call, Listed } from "@banda/ui/pane"
import type { Chime } from "@banda/ui/sound"
import { expect, test } from "vitest"
import { consume, open, start } from "../workspaces/model"
import { besideOf, first, type Shows, showing, sightOf } from "./sight"

const call = (about: string, chime: Chime, since = 0): Call => ({
  key: `s:${about}`,
  project: "s",
  about,
  chime,
  title: about,
  pane: { kind: "agents.thread", args: { thread: about } },
  since,
})

test("the Person looks at the focused Pane of the window in front", () => {
  const shows: Shows = (pane) => (pane.args.thread as string) ?? null
  const w = open(
    open(start(), "s", call("t1", "done").pane),
    "s",
    call("t2", "done").pane,
    { place: "right" }
  )
  expect(sightOf(w, { project: "s", about: "t2" }, true, shows)).toBe("looking")
  expect(sightOf(w, { project: "s", about: "t1" }, true, shows)).toBe(
    "on-screen"
  )
  expect(sightOf(w, { project: "s", about: "t3" }, true, shows)).toBe(
    "in-window"
  )
  expect(sightOf(w, { project: "other", about: "t2" }, true, shows)).toBe(
    "in-window"
  )
  expect(sightOf(w, { project: "s", about: "t2" }, false, shows)).toBe("away")
  expect(showing(w, { project: "s", about: "t1" }, shows)?.pane.args).toEqual({
    thread: "t1",
  })
  // In one column as a Deck, the Thread behind the shown Pane is out of sight.
  const grouped = consume(w, "left")
  expect(sightOf(grouped, { project: "s", about: "t1" }, true, shows)).toBe(
    "on-screen"
  )
  const decked = { display: "deck" as const }
  expect(
    sightOf(grouped, { project: "s", about: "t1" }, true, shows, decked)
  ).toBe("in-window")
})

test("what an Agent opens goes beside the Pane of the Thread it works in", () => {
  const shows: Shows = (pane) => (pane.args.thread as string) ?? null
  const listed = (id: string, agent: string): Listed => ({
    id,
    title: id,
    mark: "rest",
    changed: 0,
    agent,
    pane: call(id, "done").pane,
  })
  const browser = { kind: "browser", args: { url: "a" } }
  const lists = { s: [listed("t1", "a1"), listed("t2", "a2")] }
  // t1 | browser | t2, and t2 is shown nowhere else.
  let w = open(start(), "s", call("t1", "done").pane)
  w = open(w, "s", browser, { place: "right" })
  w = open(w, "s", call("t2", "done").pane, { place: "right" })
  const t1 = showing(w, { project: "s", about: "t1" }, shows)!
  expect(besideOf(w, lists, "a1", shows)).toEqual({
    project: "s",
    from: t1.id,
    right: [browser],
  })
  // The last column has none right of it.
  expect(besideOf(w, lists, "a2", shows)?.right).toEqual([])
  // A Thread no Pane shows has its Project alone; no Thread, nothing.
  const gone = open(start(), "s", browser)
  expect(besideOf(gone, lists, "a1", shows)).toEqual({
    project: "s",
    right: [],
  })
  expect(besideOf(w, lists, "a3", shows)).toBeNull()
})

test("Alt+U answers the loudest call first, then the one that called first", () => {
  const heard = call
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
