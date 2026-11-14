import type { ProjectId, ProjectSummary } from "@banda/contract"
import { DEFAULT_SIDEBAR } from "@banda/contract/sidebar"
import { FORGETTING, HostsContext, KeptHosts } from "@banda/core/react"
import type { MarkState } from "@banda/ui/components/banda-mark"
import type { Listed, Lists } from "@banda/ui/pane"
import { callsOf } from "@banda/ui/status"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import { nextCall } from "../calls/sight"
import { type Elsewhere, rowKey } from "./rows"
import { byOrder, order, useElsewhere, useOrderNow } from "./order"
import type { Settings } from "./settings"

const project = (id: string): ProjectSummary => ({
  id,
  name: id,
  folder: `/${id}`,
  pinned: false,
  archived: false,
  sees_others: false,
  sign: { kind: "letters", text: id, picked: false },
  trusted: true,
  scratch: false,
  missing: false,
})

const one = (id: string, mark: MarkState, changed: number): Listed => ({
  id,
  title: id,
  mark,
  changed,
  pane: { kind: "thread", args: { thread: id } },
})

/** Every call, walked with Alt+U once each from no Thread in front. */
function walk(lists: Lists, keys: readonly string[]): string[] {
  const calls = callsOf(lists, 0)
  const walked: string[] = []
  while (walked.length < calls.length)
    walked.push(nextCall(calls, keys, walked.at(-1))!.key)
  return walked
}

const byProject: Settings = { ...DEFAULT_SIDEBAR, group: "project" }

test("the sidebar list, the small inbox's among them, and Alt+U go by one order, Your turn oldest first, whatever the sidebar list shows (ADR 0087, decision 8; ADR 0098, decision 7)", () => {
  const lists = {
    ["a" as ProjectId]: [one("ask", "asking", 3), one("old", "done", 1)],
    ["b" as ProjectId]: [one("broke", "failed", 6), one("run", "working", 7)],
  }
  const projects = [project("a"), project("b")]
  const { keys } = order(lists, projects, 0)
  expect(keys).toEqual(["a:old", "a:ask", "b:broke", "b:run"])
  // Another tab, another arrangement, a group folded, a cut list whole,
  // one Project alone in view: the same order.
  for (const view of [
    { settings: byProject },
    { settings: byProject, folded: new Set(["project:a"]) },
    { tab: "archive" as const, more: true },
  ])
    expect(order(lists, projects, 0, view).keys).toEqual(keys)
  // The list draws the calls in that order.
  const drawn = order(lists, projects, 0).blocks.flatMap((block) =>
    block.kind === "rows" ? block.rows.map(({ row }) => rowKey(row)) : []
  )
  expect(drawn).toEqual(keys)
  const waiting = keys.filter((key) => !key.endsWith(":run"))
  expect(walk(lists, keys)).toEqual(waiting)
})

/** This machine's "a", and "far" on another machine, each with one that
 * asks, "far"'s the newest. */
const twoMachines = {
  ["a" as ProjectId]: [one("ask", "asking", 3), one("old", "done", 1)],
  ["far" as ProjectId]: [one("there", "asking", 5)],
}

test("another machine's Threads stand in one place in the sidebar list and for Alt+U (ADR 0079, decision 4; #999)", () => {
  // This pins the one order the two draw from; that each hands it the
  // same other machines, the test below and the architecture test pin.
  const elsewhere = [{ name: "devbox", projects: [project("far")] }]
  // What called first first, wherever it is, grouped by Project or not.
  const placed = ["a:old", "a:ask", "far:there"]
  for (const settings of [DEFAULT_SIDEBAR, byProject]) {
    const { keys } = order(twoMachines, [project("a")], 0, {
      settings,
      elsewhere,
    })
    expect(keys).toEqual(placed)
    expect(walk(twoMachines, keys)).toEqual(placed)
  }
  // Grouped by Project, the list draws the other machine's group with its
  // name, apart from this one's.
  const groups = order(twoMachines, [project("a")], 0, {
    settings: byProject,
    elsewhere,
  }).blocks.flatMap((block) =>
    block.kind === "group" ? [[block.key, block.host]] : []
  )
  expect(groups).toEqual([
    ["project:a", undefined],
    ["project:devbox/far", "devbox"],
  ])
})

test("Alt+U takes the other machines from the Window's hosts as the sidebar list does, Alt+U as they stand on the key", () => {
  const kept = new KeptHosts(
    {
      follow: () => undefined,
      engine: () => Promise.reject(new Error("No engine here.")),
      start: () => undefined,
    },
    FORGETTING
  )
  // devbox is live, of this window's build; lost is away; old is stopped.
  const build = { build: "abc", version: null }
  kept.take([
    { name: "devbox", ssh: "devbox", state: "live", ...build, own: build },
    { name: "lost", ssh: "lost", state: "away", why: "ssh ended" },
    { name: "old", ssh: "old", state: "stopped" },
  ])
  let drawn: readonly Elsewhere[] = []
  let orderNow: ReturnType<typeof useOrderNow> | undefined
  function Reads() {
    drawn = useElsewhere()
    orderNow = useOrderNow()
    return null
  }
  renderToStaticMarkup(
    createElement(HostsContext.Provider, { value: kept }, createElement(Reads))
  )
  // A machine away or stopped holds its rows as they were (#989).
  expect(drawn.map((host) => host.name)).toEqual(["devbox", "lost", "old"])
  // devbox lists "far" after the drawing: the key finds it, in its place.
  kept.projects("devbox", [project("far")])
  expect(orderNow!(twoMachines, [project("a")], 0).keys).toEqual([
    "a:old",
    "a:ask",
    "far:there",
  ])
})

test("things of one place keep their tie, and their order when it ties too", () => {
  const things = ["b:2", "x:9", "a:1", "y:9", "z:8"]
  const tie = (a: string, b: string) =>
    Number(a.split(":")[1]) - Number(b.split(":")[1])
  expect(byOrder(things, ["a:1", "b:2"], (key) => key, tie)).toEqual([
    "a:1",
    "b:2",
    "z:8",
    "x:9",
    "y:9",
  ])
})
