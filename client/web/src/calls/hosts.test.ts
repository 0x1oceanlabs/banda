import type { ProjectId, ProjectSummary } from "@banda/contract"
import { afterEach, expect, test, vi } from "vitest"
import type { HostState } from "../host"
import { type HostsDevice, KeptHosts, otherBuild, shownOf } from "./hosts"

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
  expect(first).toEqual({ name: "arc", state: connecting, projects: [] })
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

  expect(hosts.engineOf("r1" as ProjectId)).toBe(hosts.engine("arc"))
  expect(hosts.engineOf("d1" as ProjectId)).toBe(hosts.engine("devbox"))
  expect(hosts.engineOf("mine" as ProjectId)).toBeUndefined()

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

/** A WebSocket that only notes where it was opened to, and closes when
 * the test says. */
class Socket {
  static opened: Socket[] = []
  onopen?: () => void
  onmessage?: (message: { data: string }) => void
  onclose?: () => void
  readonly url: string
  constructor(url: string) {
    this.url = url
    Socket.opened.push(this)
  }
  send() {}
  close() {
    this.onclose?.()
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
