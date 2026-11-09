import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import type { Args } from "@banda/ui/module"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"
import type { HostState } from "../host"
import {
  HostsContext,
  type HostsDevice,
  KeptHosts,
  machinesOf,
  namedIn,
  otherBuild,
  type Reach,
  reachWords,
  runOnHost,
  type Shown,
  shownOf,
  useEngineOf,
  useReach,
} from "./hosts"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const project = (id: string, more: Partial<ProjectSummary> = {}) =>
  ({
    id,
    name: id,
    folder: `/${id}`,
    pinned: false,
    archived: false,
    sees_others: false,
    sign: { kind: "letters", text: "W", picked: false },
    trusted: true,
    scratch: false,
    missing: false,
    ...more,
  }) satisfies ProjectSummary

const own = { build: "def456", version: "0.1.0-dev.421" }
const live: HostState = {
  name: "arc",
  state: "live",
  build: "abc123",
  version: "0.1.0-dev.421",
  own: { build: "abc123", version: "0.1.0-dev.421" },
}
const away: HostState = { name: "arc", state: "away", why: "ssh ended" }
const connecting: HostState = { name: "arc", state: "connecting" }
/** arc before its first welcome on this device: its key. */
const unnamed = { name: "arc", icon: "desktop" }

/** A desktop whose hosts the test tells, and whose engines it answers. */
function desktop() {
  let tell: (hosts: HostState[]) => void = () => undefined
  const device = {
    follow: (take: (hosts: HostState[]) => void) => {
      tell = take
      return () => undefined
    },
    engine: vi.fn(async (name: string) => ({
      url: `ws://127.0.0.1:1/${name}`,
      secret: "s3cr3t",
    })),
    start: vi.fn(),
  } satisfies HostsDevice
  return { device, tell: (hosts: HostState[]) => tell(hosts) }
}

test("a host that goes away stays away through the tries after, its rows standing as they were", () => {
  const first = shownOf(undefined, connecting, 0)
  expect(first).toEqual({
    name: "arc",
    named: unnamed,
    state: connecting,
    projects: [],
  })
  const listed = [project("r1")]
  const lost = shownOf(
    { ...shownOf(first, live, 1), projects: listed },
    away,
    5
  )
  expect(lost).toMatchObject({ away: 5, projects: listed })
  // Another go, and another loss: still away since then.
  expect(shownOf(lost, connecting, 9)).toBe(lost)
  expect(shownOf(lost, { ...away, why: "again" }, 20)).toMatchObject({
    away: 5,
    state: { why: "again" },
  })
  // Live again, it keeps its Projects until its engine lists them anew.
  expect(shownOf(lost, live, 30)).toEqual({
    name: "arc",
    named: unnamed,
    state: live,
    projects: listed,
  })
  // Stopped, signing in or refused, it shows none.
  for (const now of [
    { name: "arc", state: "stopped" },
    { name: "arc", state: "signin", url: "https://login.tailscale.com/a" },
    { name: "arc", state: "refused", why: "no banda-dev found on arc" },
  ] satisfies HostState[])
    expect(shownOf(lost, now, 40)).toEqual({
      name: "arc",
      named: unnamed,
      state: now,
      projects: [],
    })
})

test("another build says both, the host's first", () => {
  expect(otherBuild(live)).toBeUndefined()
  expect(otherBuild({ ...live, version: "0.1.0-dev.418", own })).toBe(
    "dev.418 vs dev.421"
  )
  // Two builds of one version, as two checkouts make.
  expect(otherBuild({ ...live, own })).toBe("abc123 vs def456")
  expect(otherBuild(away)).toBeUndefined()
})

test("a host's Projects are its engine's, none archived, and never one shown before it", () => {
  const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device)
  hosts.follow()
  const devbox: HostState = { ...live, name: "devbox" }
  tell([live, devbox])
  hosts.ours([project("mine")])
  hosts.projects("arc", [
    project("mine"),
    project("r1"),
    project("old", { archived: true }),
    project("s", { scratch: true }),
  ])
  hosts.projects("devbox", [project("r1"), project("d1")])
  const ids = () =>
    hosts.get().map((host) => host.projects.map((one) => one.id))
  expect(ids()).toEqual([["r1", "s"], ["d1"]])
  // Each clash is said once.
  hosts.projects("devbox", [project("r1"), project("d1")])
  expect(warned).toHaveBeenCalledTimes(2)

  expect(hosts.hostOf("r1" as ProjectId, undefined)).toBe("arc")
  expect(hosts.hostOf("d1" as ProjectId, undefined)).toBe("devbox")
  expect(hosts.hostOf("mine" as ProjectId, undefined)).toBeUndefined()

  // A host that stops shows none, and lists none until it is live again:
  // the one after it shows what it no longer does.
  tell([{ name: "arc", state: "stopped" }, devbox])
  hosts.projects("arc", [project("r1")])
  expect(ids()).toEqual([[], ["r1", "d1"]])
  hosts.start("arc")
  expect(device.start).toHaveBeenCalledWith("arc")

  // A picture only its own engine reads shows as its first letter.
  tell([live, devbox])
  const picture = { kind: "picture", text: "v1", picked: true } as const
  hosts.projects("arc", [project("pic", { name: "émile", sign: picture })])
  expect(hosts.get()[0]!.projects[0]!.sign).toEqual({
    kind: "letters",
    text: "É",
    picked: true,
  })
})

/** A WebSocket that only notes where it was opened to and what was sent
 * on it, and closes when the test says. */
class Socket {
  static opened: Socket[] = []
  onopen?: () => void
  onmessage?: (message: { data: string }) => void
  onclose?: () => void
  readonly url: string
  readonly sent: { type: string; id: number; method?: string }[] = []
  constructor(url: string) {
    this.url = url
    Socket.opened.push(this)
  }
  send(frame: string) {
    this.sent.push(JSON.parse(frame))
  }
  close() {
    this.onclose?.()
  }
  /** Says `frame` to the page. */
  say(frame: object) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
}

test("a host's engine asks the desktop where it listens on each connect, once the host is live", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device)
  hosts.follow()
  tell([connecting])
  const engine = hosts.engine("arc")
  expect(hosts.engine("arc")).toBe(engine)
  await vi.advanceTimersByTimeAsync(1_000)
  // Not live yet: the desktop is not asked, so a refused host is not
  // tried again by it.
  expect(device.engine).not.toHaveBeenCalled()
  tell([live])
  await vi.advanceTimersByTimeAsync(0)
  expect(device.engine).toHaveBeenCalledTimes(1)
  expect(Socket.opened.map((socket) => socket.url)).toEqual([
    "ws://127.0.0.1:1/arc",
  ])
  // The connection breaks: the engine asks again, never keeping the
  // address.
  Socket.opened[0]!.close()
  await vi.advanceTimersByTimeAsync(300)
  expect(device.engine).toHaveBeenCalledTimes(2)
  // Away, it waits for the host to be live again.
  tell([away])
  Socket.opened[1]!.close()
  await vi.advanceTimersByTimeAsync(10_000)
  expect(device.engine).toHaveBeenCalledTimes(2)
  tell([live])
  await vi.advanceTimersByTimeAsync(0)
  expect(device.engine).toHaveBeenCalledTimes(3)
  engine.close()
})

test("an engine that said goodbye is made anew as its host is live again", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device)
  hosts.follow()
  tell([live])
  const engine = hosts.engine("arc")
  await vi.advanceTimersByTimeAsync(0)
  const goodbye = { code: "refused", message: "an older window" }
  Socket.opened[0]!.onmessage?.({
    data: JSON.stringify({ type: "goodbye", reason: goodbye }),
  })
  expect(engine.status.state).toBe("refused")
  expect(hosts.engine("arc")).toBe(engine)
  tell([away])
  expect(hosts.engine("arc")).toBe(engine)
  tell([live])
  const anew = hosts.engine("arc")
  expect(anew).not.toBe(engine)
  await vi.advanceTimersByTimeAsync(0)
  expect(Socket.opened).toHaveLength(2)
  anew.close()
})

test("a Pane reaches the engine of the host its args name, else of the host listing its Project; this machine's wins a clash", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device)
  hosts.follow()
  const here = { here: true } as unknown as Engine
  /** What a Pane of `project`, its args naming host `named`, reaches. */
  const reach = (project: string, named?: string) => {
    let got: Reach | undefined
    const Pane = () => {
      got = useReach(here, project as ProjectId, named)
      return null
    }
    renderToStaticMarkup(
      createElement(HostsContext, { value: hosts }, createElement(Pane))
    )
    return got!
  }

  // Before the desktop tells its hosts, as after a restart: it waits.
  expect(reach("r1", "arc")).toEqual({
    host: "arc",
    shown: undefined,
    engine: undefined,
  })
  expect(reachWords("arc", undefined)).toBe("Waiting for arc")

  tell([live])
  hosts.ours([project("mine")])
  hosts.projects("arc", [project("mine"), project("r1")])
  const arc = hosts.engine("arc")
  const named = reach("r1", "arc")
  expect(named.host).toBe("arc")
  expect(named.engine).toBe(arc)
  expect(reachWords("arc", named.shown)).toBeUndefined()
  // Its host unsaid, the one that lists the Project.
  expect(reach("r1").engine).toBe(arc)
  // A clash: this machine's Project, on its own engine, whatever the args.
  expect(reach("mine", "arc")).toEqual({ engine: here })
  expect(reach("x")).toEqual({ engine: here })
  expect(hosts.hostOf("mine" as ProjectId, "arc")).toBeUndefined()

  // Away, the Pane keeps its engine, which catches up as the host returns.
  tell([away])
  const gone = reach("r1", "arc")
  expect(gone.engine).toBe(arc)
  expect(reachWords("arc", gone.shown)).toBe("arc is away")

  let engineOf: ReturnType<typeof useEngineOf> | undefined
  const Shell = () => {
    engineOf = useEngineOf(here)
    return null
  }
  renderToStaticMarkup(
    createElement(HostsContext, { value: hosts }, createElement(Shell))
  )
  expect(engineOf!("r1" as ProjectId)).toBe(arc)
  expect(engineOf!("mine" as ProjectId)).toBe(here)
  // A Pane goes by the host its args name, never this machine's engine
  // in its place, but for a clash.
  const on = (host: string) => ({ kind: "agents.thread", args: { host } })
  expect(engineOf!("gone" as ProjectId, on("arc"))).toBe(arc)
  expect(engineOf!("mine" as ProjectId, on("arc"))).toBe(here)
  arc.close()
})

test("a pick of another host's Thread opens it on that host, never on this machine's engine with its Project", () => {
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device)
  hosts.follow()
  tell([live])
  hosts.ours([project("mine")])
  hosts.projects("arc", [project("mine"), project("r1")])
  const thread = (more: { host?: string } = {}) => ({
    kind: "agents.thread",
    args: { thread: "t1", ...more },
  })
  const on = (project: string, pane: ReturnType<typeof thread>) =>
    hosts.paneOn(project as ProjectId, pane)

  // As the lists carry it from that host: kept as it is.
  const there = thread({ host: "arc" })
  expect(on("r1", there)).toBe(there)
  // Its host unsaid: the host that lists its Project.
  expect(on("r1", thread())).toEqual(there)
  // This machine's Project, which wins a clash: on this machine.
  expect(on("mine", thread({ host: "arc" }))).toEqual(thread())
  // A Project no host lists: this machine's, as it is.
  const mine = thread()
  expect(on("x", mine)).toBe(mine)
})

test("a new Thread's machines: this one first and unnamed, then each host live or away, each with its open Projects, and an ID two have shows on the first", () => {
  const studio = { name: "Studio", icon: "server" } as const
  const shown = (
    state: HostState,
    projects: ProjectSummary[],
    more: Partial<Shown> = {}
  ): Shown => ({ name: state.name, named: studio, state, projects, ...more })
  const ours = {
    machine: "m0" as ProjectId,
    projects: [
      project("mine"),
      project("pinned", { pinned: true }),
      project("old", { archived: true }),
      project("lost", { missing: true }),
      project("scratch", { scratch: true }),
    ],
  }
  const machines = machinesOf(
    ours,
    [
      shown(live, [
        project("mine"),
        project("r1"),
        project("s1", { scratch: true }),
      ]),
      shown(
        { name: "devbox", ssh: "devbox", state: "away", why: "ssh ended" },
        [project("r1"), project("d1")],
        { away: 5 }
      ),
      shown({ name: "mini", ssh: "mini", state: "stopped" }, []),
      shown({ name: "pi", ssh: "pi", state: "connecting" }, []),
    ],
    new Map([["arc", "m1" as ProjectId]])
  )
  expect(
    machines.map(({ host, named, machine, state, away, projects }) => [
      host,
      named?.name,
      machine,
      state,
      away,
      projects.map((one) => one.id),
    ])
  ).toEqual([
    [undefined, undefined, "m0", "live", undefined, ["pinned", "mine"]],
    ["arc", "Studio", "m1", "live", undefined, ["r1"]],
    // Its engine has not said its Host scope yet: no No Project there.
    ["devbox", "Studio", undefined, "away", 5, ["d1"]],
  ])
})

test("the Window's machines follow its hosts, told again only as they say something new; this machine's No Project is its own from a Pane on another host too", () => {
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device)
  hosts.follow()
  hosts.ours([project("mine")], "m0" as ProjectId)
  tell([live])
  hosts.projects("arc", [project("r1")])
  const ids = () =>
    hosts.machines
      .get()
      .map(({ host, projects }) => [host, projects.map((one) => one.id)])
  expect(ids()).toEqual([
    [undefined, ["mine"]],
    ["arc", ["r1"]],
  ])
  expect(hosts.machines.get()[0]?.machine).toBe("m0")
  const heard = vi.fn()
  hosts.machines.subscribe(heard)
  hosts.projects("arc", [project("r1")])
  hosts.ours([project("mine")], "m0" as ProjectId)
  expect(heard).not.toHaveBeenCalled()
  // Stopped, arc has none to start in.
  tell([{ name: "arc", ssh: "arc", state: "stopped" }])
  expect(heard).toHaveBeenCalledTimes(1)
  expect(ids()).toEqual([[undefined, ["mine"]]])
  // This machine's Host scope alone changes: told again.
  hosts.ours([project("mine")], "m9" as ProjectId)
  expect(heard).toHaveBeenCalledTimes(2)
  expect(hosts.machines.get()[0]?.machine).toBe("m9")
  hosts.ours([project("mine")], "m0" as ProjectId)
  // A Pane on arc that opens this machine's No Project opens it here.
  expect(hosts.hostOf("m0" as ProjectId, "arc")).toBeUndefined()
  expect(hosts.hostOf("m1" as ProjectId, "arc")).toBe("arc")
})

test("a Pane says why it cannot reach its host in the window's own words, by the name the host says it has", () => {
  const words = (state: HostState) =>
    reachWords("arc", shownOf(undefined, state, 0))
  expect(words(connecting)).toBe("Connecting to arc")
  expect(words({ name: "arc", state: "signin", url: "https://x" })).toBe(
    "Sign in to Tailscale to reach arc"
  )
  expect(words({ name: "arc", state: "stopped" })).toBe(
    "Banda is stopped on arc"
  )
  expect(words({ name: "arc", state: "refused", why: "an older window" })).toBe(
    "arc: an older window"
  )
  // Named, it goes by that name, not by its key.
  const studio = (state: HostState) =>
    reachWords("arc", {
      ...shownOf(undefined, state, 0),
      named: { name: "Studio", icon: "desktop" },
    })
  expect(studio(away)).toBe("Studio is away")
  expect(studio({ name: "arc", state: "stopped" })).toBe(
    "Banda is stopped on Studio"
  )
  expect(
    studio({ name: "arc", state: "refused", why: "an older window" })
  ).toBe("Studio: an older window")
})

test("a Pane on another host runs none of the Window's actions on this machine's files, and its Items' on that host's alone", () => {
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device)
  hosts.follow()
  tell([live])
  hosts.ours([project("mine")])
  hosts.projects("arc", [
    project("mine"),
    project("r1"),
    project("s9", { scratch: true }),
  ])
  const ran: [string, Args | undefined][] = []
  const arc = () => hosts.get().find((one) => one.name === "arc")
  const own = { project: "r1" as ProjectId, item: "t1" }
  const run = runOnHost(
    (action, args) => void ran.push([action, args]),
    new Set(["thread.snooze"]),
    arc,
    own
  )
  run("edit.paste")
  for (const action of [
    "terminal.run",
    "file.open",
    "file.attach",
    "browser.open",
  ])
    run(action, {})
  // Its own Thread, as its Pane names it, or the one it shows.
  run("thread.snooze", { project: "r1", item: "t1", until: 5 })
  run("thread.snooze")
  // Its Thread in No Project there, one of that host's Projects.
  run("thread.snooze", { project: "s9", item: "t2" })
  // This machine's Project, which wins the ID both have: nothing.
  run("thread.snooze", { project: "mine", item: "t9" })
  // One no host shows, as a Thread not placed yet there: nothing.
  run("thread.snooze", { project: "machine", item: "t3" })
  expect(ran).toEqual([
    ["edit.paste", undefined],
    ["thread.snooze", { project: "r1", item: "t1", until: 5 }],
    ["thread.snooze", { project: "r1", item: "t1" }],
    ["thread.snooze", { project: "s9", item: "t2" }],
  ])
  // Before the Window knows that host, nothing either.
  const waiting = runOnHost(
    (action, args) => void ran.push([action, args]),
    new Set(["thread.snooze"]),
    () => undefined,
    own
  )
  waiting("thread.snooze")
  expect(ran).toHaveLength(4)

  // The Window's own Archive goes to that host's Items alone, as an App's
  // do (ADR 0096): its own Thread, never one of this machine's.
  ran.length = 0
  run("sidebar.archive")
  run("sidebar.archive", { project: "mine", item: "t9" })
  run("sidebar.snooze-picker")
  expect(ran).toEqual([["sidebar.archive", { project: "r1", item: "t1" }]])
})

test("a host goes by the name and icon its engine says, cleaned, from its welcome and each change after; before, by its key", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device)
  hosts.follow()
  // Its own key here, apart from arc's in the tests before.
  const mini: HostState = { ...live, name: "mini" }
  tell([mini])
  expect(hosts.get()[0]!.named).toEqual({ name: "mini", icon: "desktop" })
  expect(namedIn(hosts.get(), "mini")).toEqual({
    name: "mini",
    icon: "desktop",
  })

  const engine = hosts.engine("mini")
  await vi.advanceTimersByTimeAsync(0)
  const socket = Socket.opened[0]!
  socket.onopen?.()
  const named = { name: "Studio\u202E\u200B", icon: "server" }
  socket.say({ type: "welcome", engine: "e", modules: [], boot: "b", named })
  expect(hosts.get()[0]!.named).toEqual({ name: "Studio", icon: "server" })
  // Renamed there, it says so on its stream, which names no Project.
  const stream = socket.sent.find((frame) => frame.method === "machine.named")
  expect(stream).toMatchObject({ type: "stream" })
  expect(stream).not.toHaveProperty("project")
  socket.say({
    type: "piece",
    stream: stream!.id,
    data: { name: "Mac mini", icon: "watch" },
  })
  const renamed = hosts.get()[0]!
  expect(renamed.named).toEqual({ name: "Mac mini", icon: "desktop" })
  // The same again draws nothing anew.
  socket.say({
    type: "piece",
    stream: stream!.id,
    data: { name: "Mac mini", icon: "desktop" },
  })
  expect(hosts.get()[0]).toBe(renamed)
  // Away, and through the tries after, it keeps its name.
  tell([{ ...away, name: "mini" }])
  tell([{ ...connecting, name: "mini" }])
  expect(hosts.get()[0]!.named.name).toBe("Mac mini")
  expect(reachWords("mini", hosts.get()[0])).toBe("Mac mini is away")
  // A window made after, as a popped one, has the last name seen here.
  const later = new KeptHosts(desktop().device)
  expect(namedIn(later.get(), "mini")).toEqual({
    name: "Mac mini",
    icon: "desktop",
  })
  engine.close()
})
