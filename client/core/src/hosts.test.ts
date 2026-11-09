import type { ProjectId, ProjectSummary, Status } from "@banda/contract"
import type { Named } from "@banda/contract/machines"
import { afterEach, expect, test, vi } from "vitest"
import type { HostState } from "./device"
import {
  agentsWork,
  awakeWords,
  batteryWords,
  cleanPower,
  heldWords,
  type HostsDevice,
  KeptHosts,
  keyNamed,
  machinesOf,
  type Names,
  namedIn,
  otherBuild,
  reachWords,
  runOnHost,
  type Shown,
  shownOf,
} from "./hosts"
import type { Args } from "./run"

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
  ssh: "arc",
  state: "live",
  build: "abc123",
  version: "0.1.0-dev.421",
  own: { build: "abc123", version: "0.1.0-dev.421" },
}
const away: HostState = {
  name: "arc",
  ssh: "arc",
  state: "away",
  why: "ssh ended",
}
const connecting: HostState = { name: "arc", ssh: "arc", state: "connecting" }
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

/** A device that remembers no name: each host goes by its key. */
const forgetting: Names = { seen: keyNamed, follow: () => () => undefined }

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
    { name: "arc", ssh: "arc", state: "stopped" },
    {
      name: "arc",
      ssh: "arc",
      state: "signin",
      url: "https://login.tailscale.com/a",
    },
    {
      name: "arc",
      ssh: "arc",
      state: "refused",
      why: "no banda-dev found on arc",
    },
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
  const hosts = new KeptHosts(device, forgetting)
  hosts.follow()
  const devbox: HostState = { ...live, name: "devbox", ssh: "devbox" }
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
  tell([{ name: "arc", ssh: "arc", state: "stopped" }, devbox])
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
  const hosts = new KeptHosts(device, forgetting)
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
  const hosts = new KeptHosts(device, forgetting)
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

test("a host live again has its engine try at once, not after its wait", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, forgetting)
  hosts.follow()
  tell([live])
  const engine = hosts.engine("arc")
  await vi.advanceTimersByTimeAsync(0)
  // Its connection breaks again and again: each try waits longer.
  for (const wait of [250, 500, 1_000, 2_000]) {
    Socket.opened.at(-1)!.close()
    expect(engine.status).toEqual({ state: "lost", retryIn: wait })
    await vi.advanceTimersByTimeAsync(wait)
  }
  Socket.opened.at(-1)!.close()
  expect(engine.status).toEqual({ state: "lost", retryIn: 4_000 })
  const asked = device.engine.mock.calls.length
  tell([away])
  tell([live])
  await vi.advanceTimersByTimeAsync(0)
  expect(device.engine).toHaveBeenCalledTimes(asked + 1)
  // From the first wait again; and a host live still wakes nothing.
  Socket.opened.at(-1)!.close()
  expect(engine.status).toEqual({ state: "lost", retryIn: 250 })
  tell([live])
  await vi.advanceTimersByTimeAsync(0)
  expect(device.engine).toHaveBeenCalledTimes(asked + 1)
  engine.close()
})

test("a host live again while its engine waits for it has that engine wait from its first wait again", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, forgetting)
  hosts.follow()
  tell([live])
  const engine = hosts.engine("arc")
  await vi.advanceTimersByTimeAsync(0)
  // Its connection breaks again and again: its wait grows to the longest.
  for (const wait of [250, 500, 1_000, 2_000]) {
    Socket.opened.at(-1)!.close()
    await vi.advanceTimersByTimeAsync(wait)
  }
  Socket.opened.at(-1)!.close()
  // arc goes away before the next try, which waits for arc to be live.
  tell([away])
  await vi.advanceTimersByTimeAsync(4_000)
  expect(engine.status).toEqual({ state: "connecting" })
  const opened = Socket.opened.length
  tell([live])
  await vi.advanceTimersByTimeAsync(0)
  expect(Socket.opened).toHaveLength(opened + 1)
  // That try fails at once: the next waits the first wait, not 5 s.
  Socket.opened.at(-1)!.close()
  expect(engine.status).toEqual({ state: "lost", retryIn: 250 })
  engine.close()
})

test("a pick of another host's Thread opens it on that host, never on this machine's engine with its Project", () => {
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, forgetting)
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

test("a new Thread's machines: this one first and unnamed, then each host live or away, each with its Host scope and its open Projects as the Window placed them", () => {
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
  const machines = machinesOf(ours, [
    shown(
      live,
      [
        project("r1"),
        project("r2", { missing: true }),
        project("s1", { scratch: true }),
      ],
      { machine: "m1" as ProjectId }
    ),
    shown(
      { name: "devbox", ssh: "devbox", state: "away", why: "ssh ended" },
      [project("d1")],
      { away: 5 }
    ),
    shown({ name: "mini", ssh: "mini", state: "stopped" }, []),
    shown({ name: "pi", ssh: "pi", state: "connecting" }, []),
  ])
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

test("one clash rule: an ID shows on the first machine that has it, this one with every ID it knows, in the sidebar's rows and a new Thread's machines alike", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, forgetting)
  hosts.follow()
  const devbox: HostState = { ...live, name: "devbox", ssh: "devbox" }
  tell([live, devbox])
  // This machine knows its open Project, and an archived, a missing and a
  // scratch one, and its Host scope.
  hosts.ours(
    [
      project("mine"),
      project("old", { archived: true }),
      project("lost", { missing: true }),
      project("s0", { scratch: true }),
    ],
    "m0" as ProjectId
  )
  // arc has each of those Projects' IDs too, as a copy of this machine's
  // Banda has, and one of its own; devbox one of arc's, and one of its
  // own.
  hosts.projects("arc", [
    project("mine"),
    project("old"),
    project("lost"),
    project("s0"),
    project("r1"),
  ])
  hosts.projects("devbox", [project("r1"), project("d1")])
  // Their engines say their Host scopes: arc this machine's, devbox one
  // of its own.
  const welcome = (machine: string) => ({
    type: "welcome",
    engine: "0.1.0",
    modules: [],
    machine,
    boot: 1,
  })
  const arc = hosts.engine("arc")
  const box = hosts.engine("devbox")
  await vi.advanceTimersByTimeAsync(0)
  Socket.opened[0]!.say(welcome("m0"))
  Socket.opened[1]!.say(welcome("m9"))

  // The sidebar's rows: arc shows only its own, devbox not arc's.
  const rows = () =>
    hosts
      .get()
      .map((host) => [
        host.name,
        host.machine,
        host.projects.map((one) => one.id),
      ])
  expect(rows()).toEqual([
    ["arc", undefined, ["r1"]],
    ["devbox", "m9", ["d1"]],
  ])
  // A new Thread's machines say the same: arc has no No Project of its
  // own to offer, as one there would open this machine's.
  expect(
    hosts.machines
      .get()
      .map(({ host, machine, projects }) => [
        host,
        machine,
        projects.map((one) => one.id),
      ])
  ).toEqual([
    [undefined, "m0", ["mine"]],
    ["arc", undefined, ["r1"]],
    ["devbox", "m9", ["d1"]],
  ])
  // And each of them opens where it shows.
  for (const id of ["mine", "old", "lost", "s0", "m0"])
    expect(hosts.hostOf(id as ProjectId, "arc")).toBeUndefined()
  expect(hosts.hostOf("r1" as ProjectId, undefined)).toBe("arc")
  expect(hosts.hostOf("m9" as ProjectId, "devbox")).toBe("devbox")

  // This machine lets an ID go: arc's shows there from then on.
  hosts.ours([project("mine")], "m5" as ProjectId)
  expect(rows()[0]).toEqual(["arc", "m0", ["old", "lost", "s0", "r1"]])
  expect(hosts.machines.get()[1]?.machine).toBe("m0")
  arc.close()
  box.close()
})

test("the Window's machines follow its hosts, told again only as they say something new; this machine's No Project is its own from a Pane on another host too", () => {
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, forgetting)
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
    reachWords("arc", shownOf(undefined, state, 0), keyNamed)
  expect(words(connecting)).toBe("Connecting to arc")
  expect(
    words({ name: "arc", ssh: "arc", state: "signin", url: "https://x" })
  ).toBe("Sign in to Tailscale to reach arc")
  expect(words({ name: "arc", ssh: "arc", state: "stopped" })).toBe(
    "Banda is stopped on arc"
  )
  expect(
    words({ name: "arc", ssh: "arc", state: "refused", why: "an older window" })
  ).toBe("arc: an older window")
  // Named, it goes by that name, not by its key.
  const studio = (state: HostState) =>
    reachWords(
      "arc",
      {
        ...shownOf(undefined, state, 0),
        named: { name: "Studio", icon: "desktop" },
      },
      keyNamed
    )
  expect(studio(away)).toBe("Studio is away")
  expect(studio({ name: "arc", ssh: "arc", state: "stopped" })).toBe(
    "Banda is stopped on Studio"
  )
  expect(
    studio({
      name: "arc",
      ssh: "arc",
      state: "refused",
      why: "an older window",
    })
  ).toBe("Studio: an older window")
})

test("Send on a Pane on another host says what its pill says, and connects only while the host is live and its engine is not open yet", () => {
  const held = (state: HostState | undefined, status: Status["state"]) =>
    heldWords("arc", state && shownOf(undefined, state, 0), status, keyNamed)
  // Not live, the pill's words, whatever its engine says: a connection
  // that broke without closing still says open.
  for (const status of ["connecting", "lost", "refused", "open"] as const) {
    expect(held(away, status)).toBe("arc is away. Send once it is back.")
    expect(held(connecting, status)).toBe("Connecting to arc")
    expect(
      held(
        { name: "arc", ssh: "arc", state: "signin", url: "https://x" },
        status
      )
    ).toBe("Sign in to Tailscale to reach arc")
    expect(held({ name: "arc", ssh: "arc", state: "stopped" }, status)).toBe(
      "Banda is stopped on arc"
    )
    expect(
      held(
        { name: "arc", ssh: "arc", state: "refused", why: "an older window" },
        status
      )
    ).toBe("arc: an older window")
    expect(held(undefined, status)).toBe("Waiting for arc")
  }
  // Live, it connects until its engine is open.
  expect(held(live, "connecting")).toBe("Connecting to arc…")
  expect(held(live, "lost")).toBe("Connecting to arc…")
  expect(held(live, "refused")).toBe("arc refused this window")
  expect(held(live, "open")).toBeUndefined()
  // By the name the host says it has.
  const studio = { name: "Studio", icon: "desktop" } as const
  expect(
    heldWords(
      "arc",
      { ...shownOf(undefined, live, 0), named: studio },
      "connecting",
      keyNamed
    )
  ).toBe("Connecting to Studio…")
  expect(
    heldWords(
      "arc",
      { ...shownOf(undefined, away, 0), named: studio },
      "open",
      keyNamed
    )
  ).toBe("Studio is away. Send once it is back.")
})

test("a Pane on another host runs none of the Window's actions on this machine's files, and its Items' on that host's alone", () => {
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, forgetting)
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

test("a host goes by the name this device remembers until its engine says one, and the device remembers what it says", () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const memory = new Map<string, Named>([
    ["mini", { name: "Mac mini", icon: "laptop" }],
  ])
  const followed: string[] = []
  let say: (named: Named) => void = () => undefined
  const names: Names = {
    seen: (key) => memory.get(key) ?? keyNamed(key),
    follow: (_engine, key, take) => {
      followed.push(key)
      say = (named) => {
        memory.set(key, named)
        take(named)
      }
      return () => undefined
    },
  }
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, names)
  hosts.follow()
  tell([{ ...live, name: "mini", ssh: "mini" }, live])
  // Before its engine says a name: as this device last saw it, else by
  // its key.
  expect(hosts.get().map((one) => one.named)).toEqual([
    { name: "Mac mini", icon: "laptop" },
    unnamed,
  ])
  expect(namedIn(hosts.get(), "devbox", hosts.seen)).toEqual({
    name: "devbox",
    icon: "desktop",
  })
  expect(reachWords("mini", undefined, hosts.seen)).toBe("Waiting for Mac mini")

  // Its engine is followed once, as it is made.
  const engine = hosts.engine("arc")
  hosts.engine("arc")
  expect(followed).toEqual(["arc"])
  say({ name: "Studio", icon: "server" })
  const studio = hosts.get()[1]!
  expect(studio.named).toEqual({ name: "Studio", icon: "server" })
  // The same again draws nothing anew.
  say({ name: "Studio", icon: "server" })
  expect(hosts.get()[1]).toBe(studio)
  // A window made after, as a popped one, has the last name seen here.
  const later = new KeptHosts(desktop().device, names)
  expect(later.seen("arc")).toEqual({ name: "Studio", icon: "server" })
  expect(namedIn(later.get(), "arc", later.seen)).toEqual(studio.named)
  engine.close()
})

/** What arc's engine says as a window opens: open, with no name. */
const opened = {
  type: "welcome",
  engine: "0.1.0",
  modules: [],
  boot: 1,
}

/** m1pro on battery at 42%, kept awake by its Agents. */
const discharging = {
  battery: { percent: 42, charging: false, on_power: false, left: 122 },
  awake: "working",
}

/** What `socket` asked for of `machine.power`. */
const powerAsked = (socket: Socket) =>
  socket.sent.filter((frame) => frame.method === "machine.power")

test("a live host says its battery on its engine's machine.power; away it says none and is let go, and live again it is heard anew", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, forgetting)
  hosts.follow()
  tell([live])
  // Before its engine is made, nothing hears it.
  expect(hosts.get()[0]!.power).toBeUndefined()
  const engine = hosts.engine("arc")
  await vi.advanceTimersByTimeAsync(0)
  const socket = Socket.opened[0]!
  socket.say(opened)
  // A stream of the machine's, which names no Project.
  const [stream] = powerAsked(socket)
  expect(stream).toMatchObject({ type: "stream" })
  expect(stream).not.toHaveProperty("project")
  socket.say({ type: "piece", stream: stream!.id, data: discharging })
  const told = hosts.get()[0]!
  expect(told.power).toEqual(discharging)
  // The same again draws nothing anew; what changes, does.
  socket.say({ type: "piece", stream: stream!.id, data: discharging })
  expect(hosts.get()[0]).toBe(told)
  const charging = {
    battery: { percent: 67, charging: true, on_power: true, left: 48 },
    awake: null,
  }
  socket.say({ type: "piece", stream: stream!.id, data: charging })
  expect(hosts.get()[0]!.power).toEqual(charging)
  // A new state of the desktop's, live still, keeps it.
  tell([{ ...live, build: "abc124" }])
  expect(hosts.get()[0]!.power).toEqual(charging)
  expect(powerAsked(socket)).toHaveLength(1)

  // Away: the last heard is no longer true, and the stream is let go.
  tell([away])
  expect(hosts.get()[0]!.power).toBeUndefined()
  expect(socket.sent.at(-1)).toMatchObject({
    type: "unsubscribe",
    subscription: stream!.id,
  })
  socket.say({ type: "piece", stream: stream!.id, data: discharging })
  expect(hosts.get()[0]!.power).toBeUndefined()
  // Through the tries after, too.
  tell([connecting])
  expect(hosts.get()[0]!.power).toBeUndefined()

  // Live again: heard anew, once.
  tell([live])
  expect(powerAsked(socket)).toHaveLength(2)
  tell([live])
  expect(powerAsked(socket)).toHaveLength(2)
  const again = powerAsked(socket)[1]!
  socket.say({ type: "piece", stream: again.id, data: discharging })
  expect(hosts.get()[0]!.power).toEqual(discharging)
  // Taken out of hosts.toml, it is let go too.
  tell([])
  expect(socket.sent.at(-1)).toMatchObject({
    type: "unsubscribe",
    subscription: again.id,
  })
  engine.close()
})

test("an engine older than machine.power refuses it: no battery and nothing shown, and it is asked again only once its host is live again", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, forgetting)
  hosts.follow()
  tell([live])
  const engine = hosts.engine("arc")
  await vi.advanceTimersByTimeAsync(0)
  const first = Socket.opened[0]!
  first.say(opened)
  const [stream] = powerAsked(first)
  const shown = hosts.get()[0]!
  first.say({
    type: "result",
    id: stream!.id,
    error: { code: "invalid", message: 'There is no method "machine.power".' },
  })
  expect(hosts.get()[0]).toBe(shown)
  expect(shown.power).toBeUndefined()
  // Its connection breaks and is back: not asked again.
  first.close()
  await vi.advanceTimersByTimeAsync(300)
  const second = Socket.opened[1]!
  second.say(opened)
  expect(powerAsked(second)).toEqual([])
  // Away and live again, as after an update there: asked once more.
  tell([away])
  tell([live])
  expect(powerAsked(second)).toHaveLength(1)
  engine.close()
})

test("a host's engine made anew after a goodbye has its battery heard on the new one", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, forgetting)
  hosts.follow()
  tell([live])
  const engine = hosts.engine("arc")
  await vi.advanceTimersByTimeAsync(0)
  Socket.opened[0]!.say(opened)
  const [stream] = powerAsked(Socket.opened[0]!)
  Socket.opened[0]!.say({
    type: "piece",
    stream: stream!.id,
    data: discharging,
  })
  Socket.opened[0]!.say({
    type: "goodbye",
    reason: { code: "refused", message: "an older window" },
  })
  tell([away])
  expect(hosts.get()[0]!.power).toBeUndefined()
  tell([live])
  const anew = hosts.engine("arc")
  expect(anew).not.toBe(engine)
  await vi.advanceTimersByTimeAsync(0)
  const socket = Socket.opened.at(-1)!
  socket.say(opened)
  expect(powerAsked(socket)).toHaveLength(1)
  anew.close()
})

test("what another machine says of its power is taken only as the contract says it", () => {
  expect(cleanPower(discharging)).toEqual(discharging)
  // No battery, as a desktop's: none, and its why.
  expect(cleanPower({ awake: "plugged-in" })).toEqual({ awake: "plugged-in" })
  // A time not known yet is left out.
  expect(
    cleanPower({
      battery: { percent: 42, charging: false, on_power: false },
      awake: null,
    })
  ).toEqual({
    battery: { percent: 42, charging: false, on_power: false },
    awake: null,
  })
  // Words that are not one: no battery, no why.
  for (const said of [
    null,
    "42%",
    { battery: { percent: 142, charging: false, on_power: false } },
    { battery: { percent: 4.2, charging: false, on_power: false } },
    { battery: { percent: 42, charging: "no", on_power: false } },
    { battery: { percent: 42, charging: false } },
    { awake: "always" },
  ])
    expect(cleanPower(said)).toEqual({ awake: null })
  // A time that is not one is left out, and the rest stays.
  expect(
    cleanPower({
      battery: { percent: 9, charging: false, on_power: false, left: -1 },
      awake: "working",
      more: "<b>",
    })
  ).toEqual({
    battery: { percent: 9, charging: false, on_power: false },
    awake: "working",
  })
})

test("a battery says its charge, its state and its time, as decision 7 says them; a time not known yet is left out", () => {
  const battery = (more: object) => ({
    percent: 42,
    charging: false,
    on_power: false,
    ...more,
  })
  expect(batteryWords(battery({ left: 122 }))).toBe(
    "42% · on battery · 2:02 left"
  )
  expect(batteryWords(battery({ left: 21, percent: 12 }))).toBe(
    "12% · on battery · 0:21 left"
  )
  expect(
    batteryWords(
      battery({ percent: 67, charging: true, on_power: true, left: 48 })
    )
  ).toBe("67% · charging · 0:48 to full")
  // Held at 80%, as Optimized Battery Charging holds a Mac.
  expect(batteryWords(battery({ percent: 80, on_power: true }))).toBe(
    "80% · on power"
  )
  expect(batteryWords(battery({ percent: 80, on_power: true, left: 30 }))).toBe(
    "80% · on power"
  )
  expect(batteryWords(battery({}))).toBe("42% · on battery")
  expect(batteryWords(battery({ charging: true, on_power: true }))).toBe(
    "42% · charging"
  )
})

test("why a machine is awake: its Agents by this window's count, its switch, or nothing", () => {
  expect(agentsWork(1)).toBe("1 Agent works")
  expect(agentsWork(2)).toBe("2 Agents work")
  expect(awakeWords("working", 2)).toEqual({
    line: "Kept awake: 2 Agents work there.",
    short: "While 2 Agents work there",
  })
  expect(awakeWords("working", 1).line).toBe("Kept awake: 1 Agent works there.")
  // Held with none running: the 10 minutes after the last.
  expect(awakeWords("working", 0)).toEqual({
    line: "Kept awake: for 10 minutes after its last Turn.",
    short: "For 10 minutes after its last Turn",
  })
  // A window with none of its lists, as a popped-out one: no count, and
  // no guess at the 10 minutes.
  expect(awakeWords("working", undefined)).toEqual({
    line: "Kept awake: for its Agents.",
    short: "For its Agents",
  })
  expect(awakeWords("plugged-in", 2)).toEqual({
    line: "Kept awake: plugged in, its switch on.",
    short: "While plugged in, its switch on",
  })
  expect(awakeWords(null, 2)).toEqual({
    line: "Sleeps by itself when idle.",
    short: "Sleeps by itself when idle",
  })
})
