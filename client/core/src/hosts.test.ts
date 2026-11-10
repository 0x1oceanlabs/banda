import type { Engine, ProjectId, ProjectSummary, Status } from "@banda/contract"
import type { Named } from "@banda/contract/machines"
import { afterEach, expect, test, vi } from "vitest"
import type { HostState } from "./device"
import {
  agentsWork,
  asOfWords,
  awakeWords,
  awaySince,
  batteryWords,
  cleanPower,
  emptyIn,
  FORGETTING,
  heldWords,
  KeptHosts,
  keyNamed,
  machinesOf,
  type Names,
  namedIn,
  otherBuild,
  reachWords,
  type Shown,
  shownOf,
  Unreachable,
} from "./hosts"
import { inWindow } from "./directory"
import type { Args } from "./run"
import { clock } from "./time"
import { away, desktop, live, project, Socket } from "./testing"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const own = { build: "def456", version: "0.1.0-dev.421" }
const connecting: HostState = { name: "arc", ssh: "arc", state: "connecting" }
/** arc before its first welcome on this device: its key. */
const unnamed = { name: "arc", icon: "desktop" }

test("a host that goes away or stops stays so through the tries after, its rows standing as they were, as of when it was last heard", () => {
  const first = shownOf(undefined, connecting, 0)
  expect(first).toEqual({
    name: "arc",
    named: unnamed,
    state: connecting,
    projects: [],
  })
  const listed = [project("r1")]
  const shown = { ...shownOf(first, live, 1), projects: listed }
  // Its engine last heard at 4.
  const lost = shownOf(shown, away, 5, keyNamed, 4)
  expect(lost).toMatchObject({ away: 5, asOf: 4, projects: listed })
  // Another go, and another loss: still away since then, as of then.
  expect(shownOf(lost, connecting, 9)).toBe(lost)
  expect(shownOf(lost, { ...away, why: "again" }, 20, keyNamed, 9)).toEqual({
    name: "arc",
    named: unnamed,
    state: { ...away, why: "again" },
    away: 5,
    asOf: 4,
    projects: listed,
  })
  // Live again, it keeps its Projects until its engine lists them anew.
  expect(shownOf(lost, live, 30)).toEqual({
    name: "arc",
    named: unnamed,
    state: live,
    projects: listed,
  })
  // Stopped, its rows stay as they were too (#989); started again, they
  // stay while it starts, and it says so.
  const stopped: HostState = { name: "arc", ssh: "arc", state: "stopped" }
  const still = shownOf(shown, stopped, 40, keyNamed, 38)
  expect(still).toEqual({
    name: "arc",
    named: unnamed,
    state: stopped,
    away: 40,
    asOf: 38,
    projects: listed,
  })
  expect(shownOf(still, connecting, 50)).toEqual({
    ...still,
    state: connecting,
  })
  expect(shownOf(shownOf(still, connecting, 50), connecting, 60)).toEqual({
    ...still,
    state: connecting,
  })
  // Never heard, it is away as of nothing, and counts from when it was
  // found so; heard, its pill and rows count from then.
  const unheard = shownOf(undefined, away, 5, keyNamed, undefined)
  expect(unheard).not.toHaveProperty("asOf")
  expect(awaySince(unheard)).toBe(5)
  expect(awaySince(lost)).toBe(4)
  expect(awaySince(shownOf(lost, live, 30))).toBeUndefined()
  // Signing in or refused, it shows none.
  for (const now of [
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
  const hosts = new KeptHosts(device, FORGETTING)
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

  // A host that stops keeps its rows as they were, and its Panes their
  // host (#989): the one after it still shows none of them.
  tell([{ name: "arc", ssh: "arc", state: "stopped" }, devbox])
  expect(ids()).toEqual([["r1", "s"], ["d1"]])
  expect(hosts.hostOf("r1" as ProjectId, undefined)).toBe("arc")
  // Refused there, it shows none, and lists none until it is live again:
  // the one after it shows what it no longer does.
  tell([{ ...away, state: "refused" }, devbox])
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

test("a host's engine asks the desktop where it listens on each connect, once the host is live", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, FORGETTING)
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

test("an act goes to the session of the machine that owns its Project, and never to this machine's in another's place", () => {
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const here = { here: true } as unknown as Engine
  const hosts = new KeptHosts(device, FORGETTING, here)
  hosts.follow()
  const on = (host: string) => ({ args: { thread: "t1", host } })
  /** What an act on `project` is refused with, in words; none if sent. */
  const refused = (project: string, pane?: { args: Args }) => {
    try {
      hosts.sessionOf(project as ProjectId, pane)
      return undefined
    } catch (error) {
      expect(error).toBeInstanceOf(Unreachable)
      return `${(error as Unreachable).host}: ${(error as Error).message}`
    }
  }

  // Before the desktop tells its hosts: this machine's own, and none for
  // a Project of a host it does not know yet, not even this machine's.
  hosts.ours([project("mine")], "m0" as ProjectId)
  expect(hosts.sessionOf("mine" as ProjectId)).toBe(here)
  expect(hosts.sessionOf("m0" as ProjectId, on("arc"))).toBe(here)
  expect(refused("r1", on("arc"))).toBe("arc: This window does not reach arc")
  expect(Socket.opened).toEqual([])

  // Live: its host's, the one that lists it, else the host an old
  // arrangement's args name; this machine's wins a clash.
  tell([live])
  hosts.projects("arc", [project("mine"), project("r1")])
  const arc = hosts.engine("arc")
  expect(hosts.sessionOf("r1" as ProjectId, on("arc"))).toBe(arc)
  expect(hosts.sessionOf("r1" as ProjectId)).toBe(arc)
  expect(hosts.sessionOf("gone" as ProjectId, on("arc"))).toBe(arc)
  expect(hosts.sessionOf("mine" as ProjectId, on("arc"))).toBe(here)
  // A Project no machine the Window knows has fails closed, never on this
  // machine (ADR 0106, law 3).
  expect(refused("new")).toBe(": This window does not reach that machine")

  // Away: an act is refused at once, in the pill's words, and waits for
  // nothing; a Pane drawn from it keeps arc's, which catches up as arc is
  // back.
  tell([away])
  expect(refused("r1", on("arc"))).toBe("arc: arc is away")
  expect(refused("r1")).toBe("arc: arc is away")
  expect(hosts.sessionOf("r1" as ProjectId, on("arc"), { drawn: true })).toBe(
    arc
  )
  tell([{ name: "arc", ssh: "arc", state: "stopped" }])
  expect(refused("r1", on("arc"))).toBe("arc: Banda is stopped on arc")
  // Taken out of hosts.toml: none, drawn or not, and never this machine's.
  tell([])
  expect(refused("r1", on("arc"))).toBe("arc: This window does not reach arc")
  expect(() =>
    hosts.sessionOf("r1" as ProjectId, on("arc"), { drawn: true })
  ).toThrow(Unreachable)
  tell([live])
  expect(hosts.sessionOf("r1" as ProjectId, on("arc"))).toBe(arc)
  arc.close()

  // Outside a Window, with no engine of this machine's: none here either.
  const none = new KeptHosts(device, FORGETTING)
  none.ours([project("mine")])
  expect(() => none.sessionOf("mine" as ProjectId)).toThrow(
    "This window has no engine of its own."
  )
})

test("a Project this machine's engine just answered as made is this machine's at once, before its list says so, and the Projects it had stay", () => {
  const here = { here: true } as unknown as Engine
  const { device } = desktop()
  const hosts = new KeptHosts(device, FORGETTING, here)
  hosts.ours([project("mine")], "m0" as ProjectId)
  const made = "made" as ProjectId
  expect(hosts.hostOf(made)).toBeNull()
  hosts.added(project("made"))
  expect(hosts.sessionOf(made)).toBe(here)
  expect(hosts.sessionOf("mine" as ProjectId)).toBe(here)
  expect(hosts.sessionOf("m0" as ProjectId)).toBe(here)
})

test("the directory keeps on the device which machine has each Project: after a restart with arc away from the first moment, arc's Projects are arc's, this machine's its own, and one no machine has fails closed", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  Socket.opened = []
  // The device's storage, which outlives each window.
  const kept = inWindow()
  const here = { here: true } as unknown as Engine
  const before = desktop()
  const first = new KeptHosts(before.device, FORGETTING, here, {
    directory: kept,
  })
  first.follow()
  before.tell([live])
  first.ours(
    [project("mine"), project("s0", { scratch: true })],
    "m0" as ProjectId
  )
  first.projects("arc", [
    project("r1"),
    project("gone", { archived: true }),
    project("s1", { scratch: true }),
    project("mine"),
  ])
  const arc = first.engine("arc")
  await vi.advanceTimersByTimeAsync(0)
  Socket.opened[0]!.say({
    type: "welcome",
    engine: "0.1.0",
    modules: [],
    machine: "m1",
    boot: "b1",
  })
  // Each Project by its machine's ID and its key in hosts.toml; an
  // archived one too, as the Archive opens it; a clash as the window
  // places it, this machine's.
  const onArc = { machine: "m1", host: "arc" }
  expect(kept.read()).toEqual({
    mine: { machine: "m0" },
    s0: { machine: "m0" },
    m0: { machine: "m0" },
    r1: onArc,
    gone: onArc,
    s1: onArc,
    m1: onArc,
  })
  arc.close()

  // The window starts again with arc away from its first moment, and no
  // Project of this machine's read yet.
  const after = desktop()
  const again = new KeptHosts(after.device, FORGETTING, here, {
    directory: kept,
  })
  again.follow()
  expect(again.hostOf("mine" as ProjectId)).toBeUndefined()
  expect(again.sessionOf("mine" as ProjectId)).toBe(here)
  after.tell([away])
  for (const id of ["r1", "gone", "s1", "m1"])
    expect(again.hostOf(id as ProjectId), id).toBe("arc")
  // An act there is refused at once in its pill's words, and a Pane drawn
  // from it keeps arc's engine, which catches up once arc is back.
  expect(() => again.sessionOf("r1" as ProjectId)).toThrow("arc is away")
  const drawn = again.sessionOf("r1" as ProjectId, undefined, { drawn: true })
  expect(drawn).toBe(again.engine("arc"))
  // One no machine the Window knows has: refused, never this machine's.
  expect(again.hostOf("x" as ProjectId)).toBeNull()
  let refusal: unknown
  try {
    again.sessionOf("x" as ProjectId, undefined, { drawn: true })
  } catch (error) {
    refusal = error
  }
  expect(refusal).toBeInstanceOf(Unreachable)
  expect((refusal as Error).message).toBe(
    "This window does not reach that machine"
  )
  // An arrangement written before the directory kept its host is read
  // still, where the directory knows nothing of its Project.
  expect(again.hostOf("x" as ProjectId, "arc")).toBe("arc")
  expect(again.hostOf("r1" as ProjectId, "devbox")).toBe("arc")

  // arc, renamed studio in hosts.toml, is found by its ID once its engine
  // says it, before it lists anything; until then the key kept names a
  // machine the window does not reach.
  const studio = { ...live, name: "studio", ssh: "studio" }
  after.tell([{ ...studio, state: "connecting" }])
  expect(() => again.sessionOf("r1" as ProjectId)).toThrow(
    "This window does not reach arc"
  )
  after.tell([studio])
  const engine = again.engine("studio")
  await vi.advanceTimersByTimeAsync(0)
  Socket.opened.at(-1)!.say({
    type: "welcome",
    engine: "0.1.0",
    modules: [],
    machine: "m1",
    boot: "b2",
  })
  expect(again.hostOf("r1" as ProjectId)).toBe("studio")
  expect(again.sessionOf("r1" as ProjectId)).toBe(engine)
  drawn.close()
  engine.close()
})

test("an engine that said goodbye is made anew as its host is live again", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, FORGETTING)
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
  const hosts = new KeptHosts(device, FORGETTING)
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
  const hosts = new KeptHosts(device, FORGETTING)
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
  // arc goes away before the next try: its engine is away, and tries
  // nothing until arc is live.
  tell([away])
  await vi.advanceTimersByTimeAsync(4_000)
  expect(engine.status).toEqual({ state: "away" })
  const opened = Socket.opened.length
  tell([live])
  await vi.advanceTimersByTimeAsync(0)
  expect(Socket.opened).toHaveLength(opened + 1)
  // That try fails at once: the next waits the first wait, not 5 s.
  Socket.opened.at(-1)!.close()
  expect(engine.status).toEqual({ state: "lost", retryIn: 250 })
  engine.close()
})

/** What arc's engine says as a window opens: open, with no name. */
const opened = { type: "welcome", engine: "0.1.0", modules: [], boot: "b1" }

test("a host not live has its engine refuse a command at once in its pill's words, one on its way as one that may have run, and send none of them once it is back", async () => {
  vi.useFakeTimers({ now: 1_000 })
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, FORGETTING)
  hosts.follow()
  tell([live])
  const engine = hosts.engine("arc")
  await vi.advanceTimersByTimeAsync(0)
  Socket.opened[0]!.say(opened)
  expect(engine.status.state).toBe("open")

  // On its way as arc goes: refused at once, as one that may have run.
  const going = engine.command("projects.create", { name: "Going" })
  await vi.advanceTimersByTimeAsync(0)
  expect(Socket.opened[0]!.sent.at(-1)).toMatchObject({
    method: "projects.create",
  })
  vi.setSystemTime(5_000)
  tell([away])
  await expect(going).rejects.toBeInstanceOf(Unreachable)
  await expect(going).rejects.toMatchObject({
    message: "arc is away",
    host: "arc",
    machine: "arc",
    as_of: 5_000,
    may_have_run: true,
  })
  expect(engine.status).toEqual({ state: "away" })

  // Made while arc is away: refused at once, never sent; a read waits.
  const refused = engine.command("projects.create", { name: "Refused" })
  await expect(refused).rejects.toMatchObject({
    message: "arc is away",
    may_have_run: false,
  })
  const read = engine.call("projects.list", {})
  // Stopped there now: the words follow.
  tell([{ name: "arc", ssh: "arc", state: "stopped" }])
  await expect(
    engine.command("projects.create", { name: "No" })
  ).rejects.toThrow("Banda is stopped on arc")
  await vi.advanceTimersByTimeAsync(10_000)
  expect(Socket.opened).toHaveLength(1)

  // Back: the read goes, and none of the commands goes again.
  tell([live])
  await vi.advanceTimersByTimeAsync(0)
  expect(Socket.opened).toHaveLength(2)
  Socket.opened[1]!.say(opened)
  await vi.advanceTimersByTimeAsync(0)
  const calls = Socket.opened[1]!.sent.filter(({ type }) => type === "call")
  expect(calls.map(({ method }) => method)).toEqual(["projects.list"])
  Socket.opened[1]!.say({ type: "result", id: calls[0]!.id, ok: [] })
  expect(await read).toEqual([])
  engine.close()
})

test("arc's link drops before the desktop says arc is away: a mark on its way names arc as one that may have run, one made meanwhile is not sent, and a command waiting to go again fails as one that went; none goes once arc is back", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, FORGETTING)
  hosts.follow()
  tell([live])
  const engine = hosts.engine("arc")
  await vi.advanceTimersByTimeAsync(0)
  Socket.opened[0]!.say(opened)
  const once = { once: true }
  const marking = engine.commandAt(
    "projects.create",
    { name: "Mark" },
    undefined,
    undefined,
    once
  )
  const stopping = engine.command("projects.create", { name: "Stop" })
  await vi.advanceTimersByTimeAsync(0)
  expect(Socket.opened[0]!.sent.filter(({ type }) => type === "call")).toEqual([
    expect.objectContaining({ method: "projects.create" }),
    expect.objectContaining({ method: "projects.create" }),
  ])

  // The connection closes first, with arc still live to the window: the
  // mark fails at once, naming arc, as one that may have run.
  Socket.opened[0]!.close()
  await expect(marking).rejects.toMatchObject({
    name: "Unreachable",
    machine: "arc",
    may_have_run: true,
  })
  // One made now is not sent, in the words Send says meanwhile.
  await expect(
    engine.commandAt(
      "projects.create",
      { name: "No" },
      undefined,
      undefined,
      once
    )
  ).rejects.toMatchObject({
    message: "Connecting to arc",
    machine: "arc",
    may_have_run: false,
  })
  // Then arc is away: the command that waits to go again is refused as
  // the one before may have run.
  tell([away])
  await expect(stopping).rejects.toMatchObject({
    message: "arc is away",
    may_have_run: true,
  })

  // Back: none of them goes again.
  tell([live])
  await vi.advanceTimersByTimeAsync(0)
  const back = Socket.opened.at(-1)!
  back.say(opened)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(back.sent.filter(({ type }) => type === "call")).toEqual([])
  engine.close()
})

/** 14:02 today, by this machine's clock. */
const at1402 = new Date(2026, 10, 10, 14, 2, 0).getTime()

/** arc live and open in a window, its engine heard at 14:02, with its
 * Project r1. */
async function arcHeard() {
  vi.useFakeTimers({ now: at1402 })
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, FORGETTING)
  hosts.follow()
  tell([live])
  const engine = hosts.engine("arc")
  await vi.advanceTimersByTimeAsync(0)
  const [socket] = Socket.opened
  socket!.say(opened)
  hosts.projects("arc", [project("r1")])
  const arc = () => hosts.get()[0]!
  return { hosts, tell, engine, socket: socket!, arc }
}

const pings = (socket: Socket) =>
  socket.sent.filter(({ type }) => type === "ping")

test("arc's engine answers nothing to two pings in a row: arc shows away, as of when it was last heard, its rows kept, and an act fails at once; anything it says and it is live again", async () => {
  const { hosts, tell, engine, socket, arc } = await arcHeard()
  // A ping every 15 s; one answered keeps it live.
  await vi.advanceTimersByTimeAsync(15_000)
  expect(pings(socket)).toHaveLength(1)
  socket.say({ type: "pong", id: pings(socket)[0]!.id, time: at1402 + 15_100 })
  expect(engine.offset).toBe(100)
  await vi.advanceTimersByTimeAsync(15_000)
  expect(arc().state).toEqual(live)
  // From 14:02:15 on, it hears nothing: the ping at :30 has no answer by
  // :45, nor that one by 14:03:00.
  await vi.advanceTimersByTimeAsync(15_000)
  expect(arc().state).toEqual(live)
  await vi.advanceTimersByTimeAsync(15_000)
  expect(engine.stale).toBe(true)
  expect(arc()).toEqual({
    name: "arc",
    named: { name: "arc", icon: "desktop" },
    state: {
      name: "arc",
      ssh: "arc",
      state: "away",
      why: "arc has not answered since 14:02",
    },
    stale: true,
    away: at1402 + 60_000,
    asOf: at1402 + 15_000,
    projects: [project("r1")],
  })
  // By 24 hours, the day too once it is not today's.
  expect(asOfWords(arc())).toBe("as of 14:02")
  const tomorrow = at1402 + 24 * 60 * 60_000
  expect(asOfWords(arc(), tomorrow)).toBe(
    `as of ${clock(at1402, tomorrow, { hours: 24 })}`
  )
  expect(asOfWords(arc(), tomorrow)).toMatch(/^as of \S+ 14:02$/)
  // One word for the Person, as the link gone says (Q7).
  expect(reachWords("arc", arc(), keyNamed)).toBe("arc is away")
  expect(heldWords("arc", arc(), "open", keyNamed)).toBe(
    "arc is away. Send once it is back."
  )
  expect(machinesOf({ projects: [] }, hosts.get())[1]).toMatchObject({
    state: "away",
  })
  // An act is refused at once, unsent; its engine stays open to hear it.
  expect(() => hosts.sessionOf("r1" as ProjectId)).toThrow(Unreachable)
  await expect(
    engine.command("projects.create", { name: "No" })
  ).rejects.toMatchObject({ message: "arc is away", may_have_run: false })
  expect(socket.sent.filter(({ type }) => type === "call")).toEqual([])
  expect(engine.status.state).toBe("open")
  // The desktop telling arc live again changes nothing while it is quiet.
  tell([live])
  expect(arc().stale).toBe(true)

  // It says anything: live again, its rows as they were.
  socket.say({ type: "result", id: 999, ok: null })
  expect(engine.stale).toBe(false)
  expect(arc()).toEqual({
    name: "arc",
    named: { name: "arc", icon: "desktop" },
    state: live,
    projects: [project("r1")],
  })
  expect(hosts.sessionOf("r1" as ProjectId)).toBe(engine)
  engine.close()
})

test("an act on arc after 5 s of quiet asks it first: answered, it goes; with nothing in 3 s, arc shows away and the act fails unsent", async () => {
  const { engine, socket, arc } = await arcHeard()
  await vi.advanceTimersByTimeAsync(6_000)
  const asked = engine.command("projects.create", { name: "Asked" })
  await vi.advanceTimersByTimeAsync(0)
  expect(socket.sent.at(-1)?.type).toBe("ping")
  // An engine from before the ping answers it as a frame that does not
  // fit: an answer all the same.
  socket.say({
    type: "result",
    id: socket.sent.at(-1)!.id,
    error: { code: "invalid", message: "This frame does not fit." },
  })
  await vi.advanceTimersByTimeAsync(0)
  const call = socket.sent.at(-1)!
  expect(call).toMatchObject({ type: "call", method: "projects.create" })
  socket.say({ type: "result", id: call.id, ok: { name: "Asked" } })
  expect(await asked).toEqual({ name: "Asked" })
  expect(engine.offset).toBeUndefined()

  // Quiet again, and it answers nothing: the act fails at once after 3 s.
  await vi.advanceTimersByTimeAsync(6_000)
  const sent = socket.sent.length
  const unsent = engine.command("projects.create", { name: "Unsent" })
  void unsent.catch(() => undefined)
  await vi.advanceTimersByTimeAsync(2_900)
  expect(arc().state).toEqual(live)
  await vi.advanceTimersByTimeAsync(100)
  await expect(unsent).rejects.toMatchObject({
    name: "Unreachable",
    message: "arc is away",
    may_have_run: false,
  })
  expect(arc()).toMatchObject({ stale: true, asOf: at1402 + 6_000 })
  const since = socket.sent.slice(sent).map(({ type }) => type)
  expect(since).toContain("ping")
  expect(since).not.toContain("call")
  engine.close()
})

test("arc quiet, then its link gone: away in the desktop's words, as of when it was last heard; live again, its engine connects anew", async () => {
  const { tell, engine, socket, arc } = await arcHeard()
  await vi.advanceTimersByTimeAsync(45_000)
  expect(arc().stale).toBe(true)
  tell([away])
  expect(arc()).toMatchObject({
    state: away,
    away: at1402 + 45_000,
    asOf: at1402,
  })
  expect(arc().stale).toBeUndefined()
  expect(engine.stale).toBe(false)
  expect(engine.status).toEqual({ state: "away" })
  tell([live])
  await vi.advanceTimersByTimeAsync(0)
  expect(Socket.opened).toHaveLength(2)
  expect(socket).not.toBe(Socket.opened[1])
  Socket.opened[1]!.say(opened)
  expect(arc()).toMatchObject({ state: live })
  expect(arc().asOf).toBeUndefined()
  engine.close()
})

test("a host the Window shows rows of, live, away or stopped, keeps its lists; one refused lets go of them", () => {
  const listed = [project("r1")]
  const shown = { ...shownOf(undefined, live, 0), projects: listed }
  const stopped = shownOf(shown, { ...away, state: "stopped" }, 5, keyNamed, 4)
  const refused = shownOf(shown, { ...away, state: "refused" }, 5)
  expect(emptyIn([shown, shownOf(shown, away, 5), stopped])).toEqual([])
  expect(emptyIn([refused])).toEqual(["arc"])
  expect(asOfWords(stopped)).toBe(
    `as of ${clock(4, Date.now(), { hours: 24 })}`
  )
  expect(reachWords("arc", stopped, keyNamed)).toBe("Banda is stopped on arc")
})

test("a host taken out of hosts.toml has its engine refuse at once, as one the window does not reach", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const names: Names = {
    ...FORGETTING,
    seen: () => ({ name: "Studio", icon: "server" }),
  }
  const hosts = new KeptHosts(device, names)
  hosts.follow()
  // Not told yet: away from the start, and the desktop is not asked.
  const engine = hosts.engine("arc")
  await vi.advanceTimersByTimeAsync(0)
  expect(engine.status).toEqual({ state: "away" })
  expect(device.engine).not.toHaveBeenCalled()
  await expect(
    engine.command("projects.create", { name: "x" })
  ).rejects.toMatchObject({
    message: "This window does not reach Studio",
    machine: "Studio",
    may_have_run: false,
  })
  tell([live])
  await vi.advanceTimersByTimeAsync(0)
  expect(device.engine).toHaveBeenCalledTimes(1)
  tell([])
  await expect(
    engine.command("projects.create", { name: "y" })
  ).rejects.toThrow("This window does not reach Studio")
  expect(engine.status).toEqual({ state: "away" })
  engine.close()
})

test("a pick of another host's Thread keeps no host in the arrangement, as the directory says where its Project is; an old arrangement's host the directory takes first", () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, FORGETTING)
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

  // None names its host: arc's goes to arc by its Project.
  const bare = thread()
  expect(on("r1", bare)).toBe(bare)
  expect(on("r1", thread({ host: "arc" }))).toEqual(bare)
  expect(hosts.hostOf("r1" as ProjectId)).toBe("arc")
  // This machine's Project, which wins a clash: on this machine.
  expect(on("mine", thread({ host: "arc" }))).toEqual(bare)
  expect(hosts.hostOf("mine" as ProjectId)).toBeUndefined()
  // One no machine lists yet, whose args an arrangement written before
  // kept with arc: the directory takes arc, and the args let it go.
  expect(hosts.hostOf("old" as ProjectId)).toBeNull()
  expect(on("old", thread({ host: "arc" }))).toEqual(bare)
  expect(hosts.hostOf("old" as ProjectId)).toBe("arc")
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
  const hosts = new KeptHosts(device, FORGETTING)
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
  const hosts = new KeptHosts(device, FORGETTING)
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
  const hosts = new KeptHosts(device, FORGETTING)
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

  // Live again: heard anew, once, on its engine's new connection, as
  // away ended the last.
  tell([live])
  await vi.advanceTimersByTimeAsync(0)
  const back = Socket.opened[1]!
  back.say(opened)
  expect(powerAsked(back)).toHaveLength(1)
  tell([live])
  expect(powerAsked(back)).toHaveLength(1)
  const again = powerAsked(back)[0]!
  back.say({ type: "piece", stream: again.id, data: discharging })
  expect(hosts.get()[0]!.power).toEqual(discharging)
  // Taken out of hosts.toml, it is let go too.
  tell([])
  expect(back.sent.at(-1)).toMatchObject({
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
  const hosts = new KeptHosts(device, FORGETTING)
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
  // Away and live again, as after an update there: asked once more, on
  // the connection made as it is live again.
  tell([away])
  tell([live])
  await vi.advanceTimersByTimeAsync(0)
  const third = Socket.opened[2]!
  third.say(opened)
  expect(powerAsked(third)).toHaveLength(1)
  engine.close()
})

test("a host's engine made anew after a goodbye has its battery heard on the new one", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, FORGETTING)
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
