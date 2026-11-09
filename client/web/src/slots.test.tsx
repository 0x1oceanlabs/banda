import type { ProjectId, ProjectSummary } from "@banda/contract"
import type { Named } from "@banda/contract/machines"
import { ThreadMark } from "@banda/ui/components/banda-mark"
import { MachineMark } from "@banda/ui/components/machine-icon"
import { ItemsContext } from "@banda/ui/hooks/use-item"
import type { Listed, Lists } from "@banda/ui/pane"
import { type HeaderProps, Slots } from "@banda/ui/slots"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, test } from "vitest"
import {
  HostsContext,
  type HostState,
  KeptHosts,
  keyNamed,
  type Names,
  type Readable,
  Store,
} from "@banda/core/react"
import { slotsOf } from "./registry"
import { PaneSlot } from "./tiling/PaneSlot"

const thread = (mark: Listed["mark"], calls?: string, id = "t1"): Listed => ({
  id,
  title: "Hello",
  mark,
  changed: 1,
  ...(calls && { calls }),
  pane: { kind: "agents.thread", args: { thread: id } },
})

const threadPane = { kind: "agents.thread", args: { thread: "t1" } }
const terminalPane = { kind: "terminal.terminal", args: {} }

/** What the Apps list, as the Window keeps it: `listed`, in `project`. */
const lists = (project: string, ...listed: Listed[]): Readable<Lists> =>
  new Store<Lists>({ [project as ProjectId]: listed })

/** The markup, its mask's ID as React's tree gives it left out. */
const markup = (node: ReactNode) =>
  renderToStaticMarkup(node).replace(/banda-mark-[\w-]+/g, "banda-mark-id")

/** A device that remembers no name: each host goes by its key. */
const forgetting: Names = { seen: keyNamed, follow: () => () => undefined }

/** What the Slot draws with `props`, filled by the modules that run, with
 * what the Apps list as the Window gives it, `items`, and its hosts,
 * `hosts`. With no items given, it is drawn where the window gives none,
 * as in a popped-out Pane's window. */
const drawn = (
  props: HeaderProps,
  items?: Readable<Lists>,
  hosts = new KeptHosts(
    { follow: () => undefined, engine, start: () => {} },
    forgetting
  )
) => {
  const slot = (
    <HostsContext value={hosts}>
      <Slots value={slotsOf(["agents", "git"])}>
        <PaneSlot {...props} />
      </Slots>
    </HostsContext>
  )
  return markup(
    items ? <ItemsContext value={items}>{slot}</ItemsContext> : slot
  )
}

async function engine(): Promise<never> {
  throw new Error("no engine in this test")
}

test("a Thread's Pane has its Thread's Mark at its header's start, as Threads lists it, faint while nothing runs", () => {
  // Threads finds its own among what its Project lists.
  const other = thread("asking", "Run npm test?", "t0")
  const start = (listed: Listed) =>
    drawn(
      { project: "p1", pane: threadPane, at: "start" },
      lists("p1", other, listed)
    )
  const rest = thread("rest")
  expect(start(rest)).toBe(
    markup(<ThreadMark listed={rest} className="opacity-40" />)
  )
  const done = thread("done")
  expect(start(done)).toBe(markup(<ThreadMark listed={done} />))
  // After its Project, on this machine, nothing.
  expect(
    drawn({ project: "p1", pane: threadPane, at: "project" }, lists("p1", done))
  ).toBe("")
})

test("on its tile in the Overview its Mark is small, with what it asks while it calls, and none while it rests and calls not", () => {
  const overview = (listed: Listed, calling: boolean) =>
    drawn(
      { project: "p1", pane: threadPane, at: "overview", calling },
      lists("p1", listed)
    )
  expect(overview(thread("rest"), false)).toBe("")
  const running = thread("running")
  expect(overview(running, false)).toBe(
    markup(<ThreadMark listed={running} className="size-3.5" />)
  )
  const asking = thread("asking", "Run npm test?")
  expect(overview(asking, true)).toBe(
    markup(
      <>
        <ThreadMark listed={asking} className="size-3.5" />
        <span className="min-w-0 truncate">Run npm test?</span>
      </>
    )
  )
  // What it asks shows only as it calls.
  expect(overview(asking, false)).toBe(
    markup(<ThreadMark listed={asking} className="size-3.5" />)
  )
})

test("where the window gives no Items, as a popped-out Pane's window does not, a Thread's Pane has no Mark; nor has a Thread not started, or one listed in another Project", () => {
  for (const at of ["start", "project"] as const)
    expect(drawn({ project: "p1", pane: threadPane, at })).toBe("")
  expect(
    drawn({ project: "p1", pane: threadPane, at: "overview", calling: true })
  ).toBe("")
  // A New Thread shows no Thread yet.
  const unsent = { kind: "agents.thread", args: { thread: null } }
  expect(
    drawn(
      { project: "p1", pane: unsent, at: "start" },
      lists("p1", thread("done"))
    )
  ).toBe("")
  // Its Thread is its Project's: an id another Project lists is not it.
  expect(
    drawn(
      { project: "p1", pane: threadPane, at: "start" },
      lists("p2", thread("done"))
    )
  ).toBe("")
})

test("a Pane that shows no Thread has nothing of Threads', and another machine's Pane names it after its Project, in the header alone", () => {
  for (const at of ["start", "project"] as const)
    expect(
      drawn(
        { project: "p1", pane: terminalPane, at },
        lists("p1", thread("done"))
      )
    ).toBe("")
  // Nor one of another kind whose args name the Thread: only a Thread's
  // Pane shows one.
  const diff = { kind: "git.diff", args: { thread: "t1" } }
  expect(
    drawn(
      { project: "p1", pane: diff, at: "start" },
      lists("p1", thread("done"))
    )
  ).toBe("")
  // An Item another App lists, by the id the Thread's Pane shows, is not
  // a Thread's.
  const other: Listed = {
    ...thread("done"),
    pane: { kind: "browser.browser", args: {} },
  }
  expect(
    drawn({ project: "p1", pane: threadPane, at: "start" }, lists("p1", other))
  ).toBe("")

  const hosts = new KeptHosts(
    {
      follow: (take) => {
        take([arc])
        return () => undefined
      },
      engine,
      start: () => {},
    },
    forgetting
  )
  hosts.follow()
  hosts.projects("arc", [remote])
  const there = (at: "start" | "project") =>
    drawn({ project: remote.id, pane: threadPane, at }, undefined, hosts)
  const named: Named = { name: "arc", icon: "desktop" }
  expect(there("project")).toBe(
    markup(<MachineMark named={named} form="full" />)
  )
  expect(there("start")).toBe("")
  expect(
    drawn(
      { project: remote.id, pane: threadPane, at: "overview", calling: true },
      lists(remote.id, thread("done")),
      hosts
    )
  ).toBe(markup(<ThreadMark listed={thread("done")} className="size-3.5" />))
})

test("what fills the Slots is what the modules that run put there, in their order, the Window's own first", () => {
  const ids = (modules: string[]) => {
    const slots = slotsOf(modules)
    return {
      header: (slots["pane.header"] ?? []).map(({ id }) => id),
      details: (slots["thread.details"] ?? []).map(({ id }) => id),
    }
  }
  expect(ids([])).toEqual({ header: ["window.machine"], details: [] })
  expect(ids(["agents", "git"])).toEqual({
    header: ["window.machine", "agents.mark"],
    details: ["git.branch"],
  })
})

const arc: HostState = {
  name: "arc",
  ssh: "arc",
  state: "live",
  build: "abc123",
  version: "0.1.0-dev.421",
  own: { build: "abc123", version: "0.1.0-dev.421" },
}

const remote: ProjectSummary = {
  id: "r1",
  name: "bench",
  folder: "/bench",
  pinned: false,
  archived: false,
  sees_others: false,
  sign: { kind: "letters", text: "B", picked: false },
  trusted: true,
  scratch: false,
  missing: false,
}
