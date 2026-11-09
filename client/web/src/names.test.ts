/**
 * The Window's hosts go by the names this device keeps (ADR 0081, decision
 * 1; ADR 0095, decision 2): the Window makes its `KeptHosts` with the
 * kit's memory of them, as `App.tsx` and a popped-out Pane's window do,
 * and the core's store takes what it remembers and what each host says.
 */
import {
  type HostsDevice,
  type HostState,
  KeptHosts,
  namedIn,
  reachWords,
} from "@banda/core"
import { followNamed, seenNamed } from "@banda/ui/hooks/use-status"
import { afterEach, expect, test, vi } from "vitest"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const mini: HostState = {
  name: "mini",
  ssh: "mini",
  state: "live",
  build: "abc123",
  version: "0.1.0-dev.421",
  own: { build: "abc123", version: "0.1.0-dev.421" },
}

/** A desktop whose hosts the test tells, and whose engines it answers. */
function desktop() {
  let tell: (hosts: HostState[]) => void = () => undefined
  const device = {
    follow: (take: (hosts: HostState[]) => void) => {
      tell = take
      return () => undefined
    },
    engine: async (name: string) => ({
      url: `ws://127.0.0.1:1/${name}`,
      secret: "s3cr3t",
    }),
    start: () => undefined,
  } satisfies HostsDevice
  return { device, tell: (hosts: HostState[]) => tell(hosts) }
}

/** The Window's hosts, as it makes them, with this device's memory of
 * their names. */
const windowHosts = (device: HostsDevice) =>
  new KeptHosts(device, { seen: seenNamed, follow: followNamed })

/** A WebSocket that only notes what was sent on it, and says what the
 * test says to the page. */
class Socket {
  static opened: Socket[] = []
  onopen?: () => void
  onmessage?: (message: { data: string }) => void
  onclose?: () => void
  readonly sent: { type: string; id: number; method?: string }[] = []
  constructor() {
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

test("a host goes by the name and icon its engine says, cleaned, from its welcome and each change after; before, by its key", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = windowHosts(device)
  hosts.follow()
  tell([mini])
  expect(hosts.get()[0]!.named).toEqual({ name: "mini", icon: "desktop" })
  expect(namedIn(hosts.get(), "mini", seenNamed)).toEqual({
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
  tell([{ name: "mini", ssh: "mini", state: "away", why: "ssh ended" }])
  tell([{ name: "mini", ssh: "mini", state: "connecting" }])
  expect(hosts.get()[0]!.named.name).toBe("Mac mini")
  expect(reachWords("mini", hosts.get()[0], seenNamed)).toBe("Mac mini is away")
  // A window made after, as a popped one, has the last name seen here, as
  // the sidebar and a Pane's pill read it before that window knows the
  // host.
  const later = windowHosts(desktop().device)
  expect(later.seen("mini")).toEqual({ name: "Mac mini", icon: "desktop" })
  expect(namedIn(later.get(), "mini", seenNamed)).toEqual({
    name: "Mac mini",
    icon: "desktop",
  })
  expect(reachWords("mini", undefined, seenNamed)).toBe("Waiting for Mac mini")
  engine.close()
})
