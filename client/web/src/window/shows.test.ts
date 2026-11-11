import type { ProjectId } from "@banda/contract"
import { sameEach } from "@banda/core"
import { groupState } from "@banda/ui/components/banda-mark"
import type { Listed, PaneState } from "@banda/ui/pane"
import { expect, test } from "vitest"
import { followCalls, listedIn, newStores, takeLists } from "../calls/stores"
import type { Column, Entry } from "../tiling/model"
import { groupsIn, ownedIn, shownIn } from "../tiling/shows"
import { tilingShows } from "./shows"

/** What a Pane shows, as the registry's `showsOf` says it of a Thread's
 * Pane; a terminal shows nothing listed. */
const showsOf = (pane: PaneState) =>
  pane.kind === "agents.thread" ? (pane.args.thread as string) : null

/** A Thread as Threads lists it, its Agent's own. */
const thread = (id: string, more: Partial<Listed> = {}): Listed => ({
  id,
  title: `Thread ${id}`,
  mark: "working",
  changed: 0,
  agent: `agent ${id}`,
  pane: { kind: "agents.thread", args: { thread: id } },
  ...more,
})

const p = "p" as ProjectId
const q = "q" as ProjectId

/** A column in `group` of Panes in Project `project`, each the Thread
 * `shown` names, or a terminal for "-". */
function column(
  id: string,
  group: string | undefined,
  project: ProjectId,
  ...shown: string[]
): Column {
  const entries = shown.map((thing, i): Entry => ({
    id: `${id}${i}`,
    project,
    pane:
      thing === "-"
        ? { kind: "terminal.terminal", args: {} }
        : { kind: "agents.thread", args: { thread: thing } },
  }))
  return { id, entries, active: 0, ...(group !== undefined && { group }) }
}

/**
 * Each Group's Agent as the Tiling found it before T-a (`agentsOf`, which
 * read each Pane's Listed): the first Thread in it whose Agent works in
 * it. What the port says of a Group must stay what this gave.
 */
function agentsBefore(
  columns: readonly Column[],
  listed: (entry: Entry) => Listed | undefined
): Map<string, Listed> {
  const agents = new Map<string, Listed>()
  for (const { group, entries } of columns) {
    if (group === undefined || agents.has(group)) continue
    for (const entry of entries) {
      const thread = listed(entry)
      if (thread?.agent === undefined) continue
      agents.set(group, thread)
      break
    }
  }
  return agents
}

test("each Group's owner gives its state and name, as its Agent's Thread did before T-a", () => {
  const stores = newStores()
  takeLists(stores, {
    [p]: [
      thread("a", { mark: "asking" }),
      thread("b", { mark: "done" }),
      thread("c", { mark: "idle" }),
      // An Item that names no Agent: its Pane shows an Item, and its
      // Group has no owner.
      thread("d", { mark: "asking", agent: undefined }),
    ],
  })
  // Another machine's Thread, which the Window opens there.
  takeLists(stores, { [q]: [thread("x", { mark: "failed" })] }, "arc")
  const columns = [
    // A Thread, and a terminal beside it.
    column("1", "g", p, "a"),
    column("2", "g", p, "-"),
    // A first column with no Thread, then two: the first names the owner.
    column("3", "h", p, "-"),
    column("4", "h", p, "b", "c"),
    // A Thread in no Group.
    column("5", undefined, p, "c"),
    // Another machine's Thread.
    column("6", "k", q, "x"),
    // No owner: a terminal, and a New Thread not listed yet.
    column("7", "n", p, "-", "new"),
    // No owner: an Item that names no Agent.
    column("8", "m", p, "d"),
  ]
  const shows = tilingShows(stores, showsOf)
  const before = agentsBefore(columns, (entry) =>
    listedIn(stores.items.get(), entry, showsOf)
  )
  const owned = new Map(
    [...before].map(([group, it]) => [
      group,
      { state: groupState(it.mark), name: it.title },
    ])
  )
  expect(groupsIn(ownedIn(shows, columns))).toEqual(owned)
  expect(owned).toEqual(
    new Map([
      ["g", { state: "asking", name: "Thread a" }],
      ["h", { state: "done", name: "Thread b" }],
      ["k", { state: "failed", name: "Thread x" }],
    ])
  )
  // A Pane shows an Item where an App lists what it shows, in its
  // Project, on any machine: a header that names its Project before the
  // title, as the Listed said before T-a.
  const entries = columns.flatMap((one) => one.entries)
  expect(entries.map(shows.item)).toEqual(
    entries.map(
      (entry) => listedIn(stores.items.get(), entry, showsOf) !== undefined
    )
  )
  expect(entries.map(shows.item)).toEqual([
    true,
    false,
    false,
    true,
    true,
    true,
    true,
    false,
    false,
    true,
  ])
  // The owner each Pane's Item names, which gives its Group its owner.
  expect(columns.flatMap((one) => one.entries).map(shows.owner)).toEqual([
    "agent a",
    undefined,
    undefined,
    "agent b",
    "agent c",
    "agent c",
    "agent x",
    undefined,
    undefined,
    undefined,
  ])
  // An owner no App lists any more shows nothing.
  expect(shows.mark("agent gone")).toBeUndefined()
})

test("a Group's part of what a Strip selects stays as its owner's Item changes only what the Group does not show", () => {
  const stores = newStores()
  takeLists(stores, { [p]: [thread("a"), thread("b", { mark: "done" })] })
  const shows = tilingShows(stores, showsOf)
  const columns = [column("1", "g", p, "a"), column("2", "h", p, "b")]
  const first = ownedIn(shows, columns)
  expect(first).toEqual(["g", "working", "Thread a", "h", "done", "Thread b"])

  // What it was last asked, and when it changed: a new Item, the same
  // Groups.
  const items = stores.items.get()
  takeLists(stores, {
    [p]: [
      thread("a", { said: "go on", changed: 5 }),
      thread("b", { mark: "done" }),
    ],
  })
  expect(stores.items.get()[p][0]).not.toBe(items[p][0])
  expect(sameEach(ownedIn(shows, columns), first)).toBe(true)

  // Its Mark, or its title: the Group's colour or its name changes.
  takeLists(stores, {
    [p]: [thread("a", { mark: "done" }), thread("b", { mark: "done" })],
  })
  expect(sameEach(ownedIn(shows, columns), first)).toBe(false)
  takeLists(stores, {
    [p]: [thread("a", { title: "Renamed" }), thread("b", { mark: "done" })],
  })
  expect(ownedIn(shows, columns)).toEqual([
    "g",
    "working",
    "Renamed",
    "h",
    "done",
    "Thread b",
  ])
})

test("a row of the overview selects its Panes alone, and the map its Groups alone (#1099)", () => {
  const stores = newStores()
  // What calls follows the items, as in the Window.
  const stop = followCalls(stores)
  takeLists(stores, { [p]: [thread("a"), thread("b", { mark: "idle" })] })
  const shows = tilingShows(stores, showsOf)
  // The Thread a and a terminal, a Group; the Thread b in none.
  const columns = [
    column("1", "g", p, "a"),
    column("2", "g", p, "-"),
    column("3", undefined, p, "b"),
  ]
  const entries = columns.flatMap((one) => one.entries)
  // What a row of the overview selects, and what the map does.
  const row = shownIn(shows, entries)
  const map = ownedIn(shows, columns)
  expect(row).toEqual([true, undefined, false, undefined, true, undefined])
  expect(map).toEqual(["g", "working", "Thread a"])

  // The Group's owner comes to rest, then is renamed: its plate and its
  // handle change, and nothing the row draws.
  takeLists(stores, {
    [p]: [thread("a", { mark: "idle" }), thread("b", { mark: "idle" })],
  })
  expect(ownedIn(shows, columns)).toEqual(["g", undefined, "Thread a"])
  expect(sameEach(shownIn(shows, entries), row)).toBe(true)
  takeLists(stores, {
    [p]: [
      thread("a", { mark: "idle", title: "Renamed" }),
      thread("b", { mark: "idle" }),
    ],
  })
  expect(ownedIn(shows, columns)).toEqual(["g", undefined, "Renamed"])
  expect(sameEach(shownIn(shows, entries), row)).toBe(true)
  const named = ownedIn(shows, columns)

  // The Thread b, in no Group, is done and calls: the row rings it, and
  // nothing the map draws changes.
  const calls = stores.calls.get()
  takeLists(stores, {
    [p]: [
      thread("a", { mark: "idle", title: "Renamed" }),
      thread("b", { mark: "done" }),
    ],
  })
  expect(stores.calls.get()).not.toBe(calls)
  expect(shownIn(shows, entries)).toEqual([
    true,
    undefined,
    false,
    undefined,
    true,
    "done",
  ])
  expect(sameEach(ownedIn(shows, columns), named)).toBe(true)
  stop()
})
