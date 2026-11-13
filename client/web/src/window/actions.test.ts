import type { ProjectId, ProjectSummary } from "@banda/contract"
import { FORGETTING, type HostsDevice, KeptHosts } from "@banda/core"
import { ownEngine } from "@banda/core/testing"
import { type Flow, TILING_FILE } from "@banda/contract/workspaces"
import type { Action, Args } from "@banda/ui/module"
import { toast } from "@banda/ui/components/sonner"
import { expect, test, vi } from "vitest"
import { keysInForce, pressFor, withKeys } from "../actions/actions"
import { flowHere, Solo } from "../tiling/flow"
import { quiet } from "../calls/quiet"
import { arcHosts, MINE, ON_ARC, R1 } from "../tiling/testing"
import { SIDEBAR, SIDEBAR_KEYS } from "../sidebar"
import { handlesOf } from "../tiling/mount"
import { placingOf } from "../tiling/opening"
import { ACTIONS, ROUTING, runAction, type Shell, windowApiOf } from "./actions"
import { writeFlow } from "./placing"

// What the toasts were told, as Sonner still shows them.
const toasted = vi.hoisted(() => vi.fn())
vi.mock("@banda/ui/components/sonner", async (actual) => {
  const { toast } = await actual<typeof import("@banda/ui/components/sonner")>()
  const told = (...args: Parameters<typeof toast>) => {
    toasted(...args)
    return toast(...args)
  }
  return { toast: Object.assign(told, toast) }
})

/** No other machine: the hosts of a window alone. */
const NO_HOSTS: HostsDevice = {
  follow: () => undefined,
  engine: () => Promise.reject(new Error("No other machine here.")),
  start: () => undefined,
}

/** A Shell of `parts` for an action to run in by its key, through the
 * router (ADR 0106, law 3): the Person in Project "a" on this machine,
 * which has "a" and "p1", with no other machine, where `parts` says no
 * other place. */
const shellOf = (parts: object) => {
  const hosts = new KeptHosts(NO_HOSTS, FORGETTING)
  hosts.ours(projectsOf({ a: "a", p1: "p1" }))
  return {
    here: { get: () => ({ project: "a" }) },
    hosts,
    ...parts,
  } as unknown as Shell
}

/** Projects by their ids and names, as the window lists them. */
const projectsOf = (names: Record<string, string>, scratch: string[] = []) =>
  Object.entries(names).map(([id, name]) => ({
    id,
    name,
    scratch: scratch.includes(id),
  })) as unknown as ProjectSummary[]

test("a module is given the Window's API alone, as it is when asked", () => {
  let home = "a"
  const shell = new Proxy({} as Shell, {
    get: (_, key) => (key === "home" ? home : () => String(key)),
  })
  const api = windowApiOf(shell)
  for (const own of ["change", "quit", "route", "ownKeys", "toggleSidebar"])
    expect(Object.keys(api)).not.toContain(own)
  expect(api.run("thread.new")).toBe("run")
  home = "b"
  expect(api.home).toBe("b")
})

// ADR 0098, decision 21: Alt+Q turns Quiet on until it is turned off, and
// off again, however long it was on for; a module reads whether it is on.
test("Alt+Q turns Quiet on until turned off, and off, and a module reads it", () => {
  const action = ACTIONS.find((one) => one.id === "quiet.toggle")!
  expect(action.keys).toEqual([{ code: "KeyQ", mod: true }])
  expect(action.unlisted).toBeUndefined()
  const shell = shellOf({ quiet: quiet.on })
  const api = windowApiOf(shell)
  expect(quiet.get()).toBe("off")
  runAction(shell, "quiet.toggle")
  expect(quiet.get()).toBe("on")
  expect(api.quiet()).toBe(true)
  runAction(shell, "quiet.toggle")
  expect(quiet.get()).toBe("off")
  expect(api.quiet()).toBe(false)
  // On for half an hour, it goes off at once.
  quiet.turn(Date.now() + 30 * 60_000)
  runAction(shell, "quiet.toggle")
  expect(quiet.get()).toBe("off")
})

test("a Project's verbs and the menu at a route do what the sidebar's buttons did, by their ids", () => {
  const route = vi.fn()
  const settings = vi.fn()
  const command = vi.fn(() => Promise.resolve({}))
  const shell = shellOf({ route, settings, engine: { command } })

  // The menu opens at its root, and from the key sheet's button at
  // its Actions (`openingOf`), as `banda menu` does.
  runAction(shell, "menu.at")
  runAction(shell, "menu.at", { route: "actions" })
  // A missing Project's folder is found in the menu; its settings are its
  // own.
  runAction(shell, "projects.locate", { project: "p1" })
  runAction(shell, "projects.settings", { project: "p1" })
  expect(route.mock.calls).toEqual([[""], ["actions"], ["project.locate.p1"]])
  expect(settings.mock.calls).toEqual([["projects/p1"]])

  // A pin goes to the engine as the Project's update, and only with a
  // Project and whether it is pinned.
  runAction(shell, "projects.pin", { project: "p1", pinned: true })
  runAction(shell, "projects.pin", { project: "p1", pinned: false })
  const halves: (Args | undefined)[] = [
    undefined,
    { project: "p1" },
    { pinned: true },
  ]
  for (const args of halves) runAction(shell, "projects.pin", args)
  runAction(shell, "projects.locate")
  runAction(shell, "projects.settings", { project: 1 })
  expect(command.mock.calls).toEqual([
    ["projects.update", { project: "p1", pinned: true }],
    ["projects.update", { project: "p1", pinned: false }],
  ])
  expect(route).toHaveBeenCalledTimes(3)
  expect(settings).toHaveBeenCalledTimes(1)
})

test("flow.solo and a pick of Solo or the row write nothing, as Solo is this device's view; a pick between free and the row writes tiling.toml, and a word it does not know nothing (ADR 0127, decision 3)", async () => {
  const writeSetting = vi.fn(() => Promise.resolve([] as string[]))
  // The Window's own Solo, and the Flow it shows where the file says
  // `file`, as `useFlowHere` gives them.
  const solo = new Solo()
  let file: Flow = "row"
  const flowNow = () => flowHere(file, solo.get())
  const shell = shellOf({
    pickFlow: (flow: Flow) => writeFlow(writeSetting, solo.pick(flow, file)),
    placing: () => placingOf(flowNow(), []),
  })

  // Its key, to Solo and back, and the bar's menu: here alone.
  runAction(shell, "flow.solo")
  expect(flowNow()).toBe("solo")
  runAction(shell, "flow.solo")
  expect(flowNow()).toBe("row")
  runAction(shell, "flow.pick", { flow: "solo" })
  expect(flowNow()).toBe("solo")
  runAction(shell, "flow.pick", { flow: "row" })
  expect(flowNow()).toBe("row")
  for (const args of [undefined, { flow: "toString" }, { flow: 1 }])
    runAction(shell, "flow.pick", args)
  expect(writeSetting).not.toHaveBeenCalled()

  // Free and the row are how the engine places, the file's: from free,
  // Solo takes the row with it.
  runAction(shell, "flow.pick", { flow: "free" })
  file = "free"
  runAction(shell, "flow.solo")
  expect(writeSetting.mock.calls).toEqual([
    [TILING_FILE.name, "flow", '"free"'],
    [TILING_FILE.name, "flow", '"row"'],
  ])
  file = "row"
  expect(flowNow()).toBe("solo")
  runAction(shell, "flow.pick", { flow: "free" })
  file = "free"

  // A refused write says so in the console, as the menu's did.
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined)
  writeSetting.mockResolvedValueOnce(["flow: not a Flow"])
  runAction(shell, "flow.pick", { flow: "row" })
  await vi.waitFor(() =>
    expect(error).toHaveBeenCalledWith(`banda: ${TILING_FILE.name} refused`, [
      "flow: not a Flow",
    ])
  )
  error.mockRestore()
})

test("the sidebar's keys are its scope's, none held with a mod (ADR 0098, decision 13)", () => {
  // Only while the focus is in the sidebar, where a field types them.
  const keys = ACTIONS.filter((action) => action.scope === SIDEBAR)
  expect(keys.map((action) => action.id)).toEqual(
    SIDEBAR_KEYS.map((key) => key.id)
  )
  for (const { keys: bound = [] } of keys)
    for (const key of bound)
      expect([key.alt, key.ctrl, key.super, key.mod]).toEqual(
        Array(4).fill(undefined)
      )
  // Undo holds Ctrl, ⌘ on a Mac, as a field's own does, and so do Select
  // all, Ctrl+A, and Delete's Ctrl+Backspace, ⌘⌫ (§2.7); no other.
  expect(
    keys.filter(({ keys: bound = [] }) => bound.some((key) => key.primary))
  ).toEqual([
    expect.objectContaining({ id: "sidebar.select-all" }),
    expect.objectContaining({ id: "sidebar.undo" }),
    expect.objectContaining({ id: "sidebar.delete-picked" }),
  ])
  // The card's menu, by Shift+F10 or the Menu key, and Delete, in the
  // Archive (ADR 0098, decision 14).
  const keysOf = (id: string) => keys.find((key) => key.id === id)?.keys
  expect(keysOf("sidebar.menu-picked")).toEqual([
    { code: "F10", shift: true },
    { code: "ContextMenu" },
  ])
  expect(keysOf("sidebar.delete-picked")).toEqual([
    { code: "Delete" },
    { code: "Backspace", primary: true },
  ])
  // Several at once (decision 15): X or Space checks the card picked,
  // Ctrl+A every card shown.
  expect(keysOf("sidebar.select-picked")).toEqual([
    { code: "KeyX" },
    { code: "Space" },
  ])
  expect(keysOf("sidebar.select-all")).toEqual([
    { code: "KeyA", primary: true },
  ])
})

test("Ctrl+Z is Undo Arrange by Project's among every owner's keys, but a Pane's own Undo comes first, and never a page's", () => {
  const keyed = withKeys(ACTIONS, [])
  const ctrlZ = {
    code: "KeyZ",
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    shiftKey: false,
  }
  expect(pressFor(keyed, ctrlZ)?.action.id).toBe("workspaces.unarrange")
  // A Pane's own Undo comes first, as Files'.
  expect(pressFor(keyed, ctrlZ, ["files"])?.action.id).toBe("files.undo")
  // Main never takes it from a browser's page.
  const inForce = keysInForce({ alt: true, ctrl: false, super: false }, keyed)
  const taken = inForce.byScope.get("") ?? []
  expect(taken.some((key) => key.code === "KeyZ" && !key.alt)).toBe(false)
})

test("an action from a key goes through the router as one from a Pane: on arc, what arc does not run says so, the same words from each (ADR 0106, law 3)", () => {
  // The Person is in arc's Thread, whose machine runs Threads alone.
  const hosts = arcHosts(["agents"])
  const route = vi.fn()
  const shell = shellOf({
    hosts,
    route,
    here: {
      get: () => ({
        project: R1,
        pane: { id: "e1", project: R1, subject: "t1", host: "arc" },
      }),
    },
  })
  const ran = vi.fn()
  const { run } = handlesOf(hosts, ROUTING, ON_ARC, ran, {
    kind: "agents.thread",
    args: { thread: "t1", host: "arc" },
  })
  const titleOf = (id: string) => ACTIONS.find((one) => one.id === id)!.title
  // The device's, an App arc lacks, and this device's disk: refused alike.
  for (const [id, args] of [
    ["browser.open", { address: "https://example.com" }],
    ["git.diff", undefined],
    ["file.folder", { file: "/r1/a.ts" }],
  ] as const) {
    const said = `Not on arc yet: ${titleOf(id)}`
    toasted.mockClear()
    runAction(shell, id, args)
    expect(toasted, id).toHaveBeenCalledWith(said, { id: expect.any(String) })
    toasted.mockClear()
    run!(id, args)
    expect(toasted, id).toHaveBeenCalledWith(said, { id: expect.any(String) })
  }
  expect(ran).not.toHaveBeenCalled()
  // The window's own runs from each.
  runAction(shell, "menu.at", { route: "actions" })
  expect(route).toHaveBeenCalledWith("actions")
  run!("menu.at", { route: "actions" })
  expect(ran).toHaveBeenCalledWith("menu.at", { route: "actions" })
})

test("a key's act on a Project this machine added since its list was read runs, once that list is read again; one no machine has is refused (ADR 0106, law 3)", async () => {
  const added = "added" as ProjectId
  const { engine } = ownEngine({
    call: () => Promise.resolve(projectsOf({ a: "a", added: "added" })),
  })
  const hosts = new KeptHosts(NO_HOSTS, FORGETTING, engine)
  hosts.ours(projectsOf({ a: "a" }), "m0" as ProjectId)
  const ran = vi.fn()
  const shell = shellOf({
    hosts,
    route: ran,
    here: { get: () => ({ project: "a" as ProjectId }) },
  })
  // An App's act, with what the run does in the test's hands.
  const act: Action<Shell> = {
    ...ACTIONS.find((one) => one.id === "thread.new")!,
    run: (_, args) => ran(args),
  }
  toasted.mockClear()
  runAction(shell, act, { project: added })
  expect(ran).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(ran).toHaveBeenCalledWith({ project: added }))
  expect(toasted).not.toHaveBeenCalled()

  ran.mockClear()
  runAction(shell, act, { project: "x" as ProjectId })
  await vi.waitFor(() =>
    expect(toasted).toHaveBeenCalledWith(
      "This window does not reach that machine",
      { id: expect.any(String) }
    )
  )
  expect(ran).not.toHaveBeenCalled()
})

test("a key in a Pane acts on the machine Here says, an old arrangement's host where the directory knows nothing of its Project, and none where nothing says one (ADR 0106, decision 1)", async () => {
  const hosts = arcHosts(["agents"])
  const project = "old" as ProjectId
  const pane = { id: "e1", project }
  const said = `Not on arc yet: ${ACTIONS.find((one) => one.id === "git.diff")!.title}`
  toasted.mockClear()
  runAction(
    shellOf({
      hosts,
      here: { get: () => ({ project, pane: { ...pane, host: "arc" } }) },
    }),
    "git.diff"
  )
  expect(toasted).toHaveBeenCalledWith(said, { id: expect.any(String) })
  toasted.mockClear()
  runAction(
    shellOf({ hosts, here: { get: () => ({ project, pane }) } }),
    "git.diff"
  )
  await vi.waitFor(() =>
    expect(toasted).toHaveBeenCalledWith(
      "This window does not reach that machine",
      { id: expect.any(String) }
    )
  )
})

test("a file act checks the file on its Project's machine and carries the Project; what reaches this device's disk stays refused there (ADR 0106, law 1 and law 3)", async () => {
  // The file's stat, as arc's engine answers it.
  const stat = vi.fn(async (): Promise<unknown[]> => [{ path: "/r1/a.ts" }])
  const session = { call: stat }
  const sessionOf = vi.fn(() => session)
  const run = vi.fn()
  const attach = vi.fn()
  const shell = shellOf({
    hosts: arcHosts(["agents", "files"]),
    run,
    attach,
    sessionOf,
    here: { get: () => ({ project: R1 }) },
  })
  const done = async (id: string, args: Args) => {
    runAction(shell, id, args)
    await vi.waitFor(() => expect(stat).toHaveBeenCalled())
    await stat.mock.results[0]!.value
    await Promise.resolve()
  }
  await done("file.peek", { file: "/r1/a.ts", project: R1 })
  expect(sessionOf).toHaveBeenCalledWith(R1, undefined)
  // Part of the act: refused whole while its machine is away, never done
  // later by itself.
  expect(stat).toHaveBeenCalledWith(
    "files.stat",
    { paths: ["/r1/a.ts"] },
    { project: R1, once: true }
  )
  expect(run).toHaveBeenCalledWith("files.peek", {
    file: "/r1/a.ts",
    project: R1,
  })

  // The file's Project, not the one the Person is in.
  stat.mockClear()
  sessionOf.mockClear()
  const elsewhere = shellOf({
    hosts: arcHosts(["agents", "files"]),
    run,
    sessionOf,
    here: { get: () => ({ project: MINE }) },
  })
  runAction(elsewhere, "file.peek", { file: "/r1/a.ts", project: R1 })
  await vi.waitFor(() => expect(stat).toHaveBeenCalled())
  expect(sessionOf).toHaveBeenCalledWith(R1, undefined)

  // The Pane in focus goes with it, saying where a Project not listed yet
  // is.
  stat.mockClear()
  sessionOf.mockClear()
  const inPane = shellOf({
    hosts: arcHosts(["agents", "files"]),
    run,
    sessionOf,
    here: { get: () => ({ project: R1, pane: { project: R1, host: "arc" } }) },
  })
  runAction(inPane, "file.peek", { file: "/r1/a.ts" })
  await vi.waitFor(() => expect(stat).toHaveBeenCalled())
  expect(sessionOf).toHaveBeenCalledWith(R1, { args: { host: "arc" } })

  stat.mockClear()
  run.mockClear()
  await done("file.open", { file: "/r1/a.ts", project: R1, line: 3 })
  expect(run).toHaveBeenCalledWith("files.open", {
    file: "/r1/a.ts",
    project: R1,
    line: 3,
  })

  stat.mockClear()
  await done("file.attach", { file: "/r1/a.ts", project: R1 })
  expect(attach).toHaveBeenCalledWith({ path: "/r1/a.ts", project: R1 })

  // A file gone on its machine says so, and nothing is done.
  stat.mockClear()
  run.mockClear()
  toasted.mockClear()
  stat.mockResolvedValueOnce([null])
  const warned = vi.spyOn(toast, "warning")
  await done("file.peek", { file: "/r1/gone.ts", project: R1 })
  expect(run).not.toHaveBeenCalled()
  expect(warned).toHaveBeenCalledWith("No such file: /r1/gone.ts")
  warned.mockRestore()

  // That Project's machine away: refused at once, in its pill's words.
  stat.mockClear()
  run.mockClear()
  toasted.mockClear()
  sessionOf.mockImplementationOnce(() => {
    throw new Error("arc is away")
  })
  runAction(shell, "file.peek", { file: "/r1/a.ts", project: R1 })
  expect(stat).not.toHaveBeenCalled()
  expect(run).not.toHaveBeenCalled()
  expect(toasted).toHaveBeenCalledWith("arc is away", {
    id: expect.any(String),
  })

  // The answer lost on its way, likewise: the act is not done later.
  toasted.mockClear()
  stat.mockRejectedValueOnce(new Error("arc went away"))
  runAction(shell, "file.peek", { file: "/r1/a.ts", project: R1 })
  await vi.waitFor(() =>
    expect(toasted).toHaveBeenCalledWith("arc went away", {
      id: expect.any(String),
    })
  )
  expect(run).not.toHaveBeenCalled()

  // Its machine does not run Files: said, not asked.
  toasted.mockClear()
  stat.mockClear()
  const without = shellOf({
    hosts: arcHosts(["agents"]),
    sessionOf,
    here: { get: () => ({ project: R1 }) },
  })
  runAction(without, "file.peek", { file: "/r1/a.ts", project: R1 })
  expect(stat).not.toHaveBeenCalled()
  expect(toasted).toHaveBeenCalledWith("Not on arc yet: Quick Look at a file", {
    id: expect.any(String),
  })

  // A file of this device's disk: not on arc, with no asking at all.
  for (const id of ["file.outside", "file.folder"]) {
    toasted.mockClear()
    runAction(shell, id, { file: "/r1/a.ts", project: R1 })
    expect(toasted, id).toHaveBeenCalledWith(
      expect.stringMatching(/^Not on arc yet: /),
      { id: expect.any(String) }
    )
  }
})

test("a file attached from a Pane carries the Pane's Project through the router (ADR 0106, law 3)", () => {
  const ran = vi.fn()
  const { run } = handlesOf(
    arcHosts(["agents", "files"]),
    ROUTING,
    ON_ARC,
    ran,
    {
      kind: "agents.thread",
      args: { thread: "t1", host: "arc" },
    }
  )
  run!("file.attach", { file: "/r1/a.ts" })
  expect(ran).toHaveBeenCalledWith("file.attach", {
    file: "/r1/a.ts",
    project: R1,
  })
})
