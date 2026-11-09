import type { ProjectSummary } from "@banda/contract"
import type { Named } from "@banda/contract/machines"
import { ThreadMark } from "@banda/ui/components/banda-mark"
import { MachineMark } from "@banda/ui/components/machine-icon"
import type { Listed } from "@banda/ui/pane"
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
} from "@banda/core/react"
import { slotsOf } from "./registry"
import { PaneSlot } from "./tiling/PaneSlot"

const thread = (mark: Listed["mark"], calls?: string): Listed => ({
  id: "t1",
  title: "Hello",
  mark,
  changed: 1,
  ...(calls && { calls }),
  pane: { kind: "agents.thread", args: { thread: "t1" } },
})

const threadPane = { kind: "agents.thread", args: { thread: "t1" } }
const terminalPane = { kind: "terminal.terminal", args: {} }

/** The markup, its mask's ID as React's tree gives it left out. */
const markup = (node: ReactNode) =>
  renderToStaticMarkup(node).replace(/banda-mark-[\w-]+/g, "banda-mark-id")

/** A device that remembers no name: each host goes by its key. */
const forgetting: Names = { seen: keyNamed, follow: () => () => undefined }

/** What the Slot draws with `props`, filled by the modules that run, with
 * the Window's hosts `hosts`. */
const drawn = (
  props: HeaderProps,
  hosts = new KeptHosts(
    { follow: () => undefined, engine, start: () => {} },
    forgetting
  )
) =>
  markup(
    <HostsContext value={hosts}>
      <Slots value={slotsOf(["agents", "git"])}>
        <PaneSlot {...props} />
      </Slots>
    </HostsContext>
  )

async function engine(): Promise<never> {
  throw new Error("no engine in this test")
}

test("a Thread's Pane has its Mark at its header's start, as the Tiling drew it, faint while nothing runs", () => {
  const rest = thread("rest")
  expect(
    drawn({ project: "p1", pane: threadPane, listed: rest, at: "start" })
  ).toBe(markup(<ThreadMark listed={rest} className="opacity-40" />))
  const done = thread("done")
  expect(
    drawn({ project: "p1", pane: threadPane, listed: done, at: "start" })
  ).toBe(markup(<ThreadMark listed={done} />))
  // After its Project, on this machine, nothing.
  expect(
    drawn({ project: "p1", pane: threadPane, listed: done, at: "project" })
  ).toBe("")
})

test("on its tile in the Overview its Mark is small, with what it asks while it calls, and none while it rests and calls not", () => {
  const overview = (listed: Listed, calling: boolean) =>
    drawn({ project: "p1", pane: threadPane, listed, at: "overview", calling })
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

test("a Pane that shows no Thread has nothing of Threads', and another machine's Pane names it after its Project, in the header alone", () => {
  for (const at of ["start", "project"] as const)
    expect(
      drawn({ project: "p1", pane: terminalPane, listed: undefined, at })
    ).toBe("")
  // An Item another App lists is not a Thread's.
  const other: Listed = {
    ...thread("done"),
    pane: { kind: "browser.browser", args: {} },
  }
  expect(
    drawn({ project: "p1", pane: terminalPane, listed: other, at: "start" })
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
  const there = (at: "start" | "project", listed?: Listed) =>
    drawn({ project: remote.id, pane: threadPane, listed, at }, hosts)
  const named: Named = { name: "arc", icon: "desktop" }
  expect(there("project")).toBe(
    markup(<MachineMark named={named} form="full" />)
  )
  expect(there("start")).toBe("")
  expect(
    drawn(
      {
        project: remote.id,
        pane: threadPane,
        listed: thread("done"),
        at: "overview",
        calling: true,
      },
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
