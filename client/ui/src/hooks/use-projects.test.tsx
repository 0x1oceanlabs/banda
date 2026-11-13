// @vitest-environment happy-dom
import {
  type Engine,
  type Event,
  type EventFilter,
  type ProjectChanged,
  type ProjectId,
  type ProjectList,
  type ProjectSummary,
  Refused,
  type Status,
} from "@banda/contract"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, test } from "vitest"
import { useProjects } from "./use-projects"

const flags = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
beforeEach(() => {
  flags.IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => {
  for (const root of mounted.splice(0)) act(() => root.unmount())
})

const MACHINE = "m0" as ProjectId

const project = (id: string, more: Partial<ProjectSummary> = {}) =>
  ({
    id,
    name: id,
    folder: `/${id}`,
    pinned: false,
    archived: false,
    sees_others: false,
    sign: { kind: "letters", text: id[0]!.toUpperCase(), picked: false },
    trusted: true,
    scratch: false,
    missing: false,
    ...more,
  }) satisfies ProjectSummary

/**
 * A machine's engine as the hook asks it: it answers `projects.listed`
 * with its list and its log's place, unless it is from `before` the fact,
 * and tells who follows its log each fact it `says`.
 */
function machine({ before = false } = {}) {
  let list: ProjectSummary[] = []
  let at = 0
  let status: Status = {
    state: "open",
    engine: "0.1.0",
    modules: [],
    machine: MACHINE,
    boot: "b1",
  }
  const watchers = new Set<(status: Status) => void>()
  const following: {
    project: ProjectId
    after: number
    filter: EventFilter
    onEvent: (event: Event) => void
  }[] = []
  const calls: string[] = []
  const engine = {
    get status() {
      return status
    },
    watch: (watcher: (status: Status) => void) => {
      watchers.add(watcher)
      watcher(status)
      return () => watchers.delete(watcher)
    },
    call: async (method: string) => {
      calls.push(method)
      if (method === "projects.list") return list
      if (method !== "projects.listed" || before)
        throw new Refused({
          code: "invalid",
          message: `There is no method "${method}".`,
        })
      return { at, projects: list } satisfies ProjectList
    },
    follow: (
      project: ProjectId,
      after: number,
      filter: EventFilter,
      onEvent: (event: Event) => void
    ) => {
      const one = { project, after, filter, onEvent }
      following.push(one)
      return () => void following.splice(following.indexOf(one), 1)
    },
  } as unknown as Engine
  return {
    engine,
    calls,
    following,
    /** The machine's list reads `projects` now, and its log says so of
     * `changed`, to who follows it from before. */
    says(projects: ProjectSummary[], changed: ProjectChanged) {
      list = projects
      at += 1
      const event = {
        seq: at,
        id: `e${at}`,
        module: "projects",
        kind: "changed",
        version: 1,
        subject: changed.project,
        author: { kind: "person", id: "me" },
        at: 0,
        payload: changed,
      } as Event
      for (const one of [...following])
        if (one.after < event.seq) one.onEvent(event)
    },
    /** Its list reads `projects` now, and no fact says so. */
    keeps(projects: ProjectSummary[]) {
      list = projects
    },
    /** Its engine started anew, as `boot`. */
    restarts(boot: string) {
      status = { ...status, boot } as Status
      for (const watcher of watchers) watcher(status)
    },
  }
}

const mounted: ReturnType<typeof createRoot>[] = []

/** The hook, mounted on `engine`: what it says now. */
async function mount(engine: Engine) {
  const seen: { now?: ReturnType<typeof useProjects> } = {}
  function Probe() {
    seen.now = useProjects(engine)
    return null
  }
  const root = createRoot(document.createElement("div"))
  mounted.push(root)
  await act(async () => root.render(<Probe />))
  return {
    names: () => {
      const listed = seen.now!.listed
      return listed.state === "ready" ? listed.value.map((p) => p.name) : null
    },
    listed: () => seen.now!.listed,
    put: (one: ProjectSummary) => act(async () => seen.now!.put(one)),
  }
}

test("the list follows what its machine says of its Projects, and is read at no other time (ADR 0127)", async () => {
  const arc = machine()
  arc.keeps([project("work")])
  const hook = await mount(arc.engine)
  expect(hook.names()).toEqual(["work"])
  expect(arc.calls).toEqual(["projects.listed"])
  // It follows the machine's log from where the list was read, and only
  // the kernel's fact of the Projects.
  expect(arc.following).toMatchObject([
    {
      project: MACHINE,
      after: 0,
      filter: { module: "projects", kinds: ["changed"] },
    },
  ])

  // Added, renamed and removed elsewhere, as by `banda project add`.
  await act(async () =>
    arc.says([project("work"), project("play")], {
      project: "play",
      change: "added",
    })
  )
  expect(hook.names()).toEqual(["work", "play"])
  await act(async () =>
    arc.says([project("work", { name: "Work" }), project("play")], {
      project: "work",
      change: "updated",
    })
  )
  expect(hook.names()).toEqual(["Work", "play"])
  await act(async () =>
    arc.says([project("play")], { project: "work", change: "removed" })
  )
  expect(hook.names()).toEqual(["play"])
  expect(arc.calls).toHaveLength(4)
  expect(arc.following).toMatchObject([{ project: MACHINE, after: 3 }])

  // The window coming to the front reads nothing: what no fact said
  // stays unread.
  arc.keeps([])
  await act(async () => {
    window.dispatchEvent(new Event("blur"))
    window.dispatchEvent(new Event("focus"))
  })
  expect(hook.names()).toEqual(["play"])
  expect(arc.calls).toHaveLength(4)
})

test("a list that says what it said keeps the one before", async () => {
  const arc = machine()
  arc.keeps([project("work")])
  const hook = await mount(arc.engine)
  const first = hook.listed()
  await act(async () =>
    arc.says([project("work")], { project: "work", change: "updated" })
  )
  expect(arc.calls).toHaveLength(2)
  expect(hook.listed()).toBe(first)
})

test("a Project put is drawn ahead of the list that says it, and the next list read wins", async () => {
  const arc = machine()
  arc.keeps([project("work")])
  const hook = await mount(arc.engine)
  await hook.put(project("play"))
  expect(hook.names()).toEqual(["work", "play"])
  expect(arc.calls).toHaveLength(1)
  // The machine says it made it, by another name than was put.
  await act(async () =>
    arc.says([project("play", { name: "Play" }), project("work")], {
      project: "play",
      change: "added",
    })
  )
  expect(hook.names()).toEqual(["Play", "work"])
  // And one the machine never made goes as its next list says nothing of it.
  await hook.put(project("ghost"))
  expect(hook.names()).toEqual(["Play", "work", "ghost"])
  await act(async () =>
    arc.says([project("play", { name: "Play" })], {
      project: "work",
      change: "removed",
    })
  )
  expect(hook.names()).toEqual(["Play"])
})

test("an engine started anew is read again: what it found as it started, no fact says", async () => {
  const arc = machine()
  arc.keeps([project("work")])
  const hook = await mount(arc.engine)
  arc.keeps([project("work", { name: "Work", missing: true })])
  await act(async () => arc.restarts("b2"))
  expect(hook.names()).toEqual(["Work"])
  expect(arc.calls).toHaveLength(2)
})

test("an engine from before the fact gives its list, which is followed from the start of its log", async () => {
  const old = machine({ before: true })
  old.keeps([project("work")])
  const hook = await mount(old.engine)
  expect(hook.names()).toEqual(["work"])
  expect(old.calls).toEqual(["projects.listed", "projects.list"])
  expect(old.following).toMatchObject([{ project: MACHINE, after: 0 }])
})
