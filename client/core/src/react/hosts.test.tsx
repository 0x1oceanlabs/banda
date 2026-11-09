import type { Engine, ProjectId, ProjectSummary } from "@banda/contract"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"
import type { HostState } from "../device"
import { type HostsDevice, KeptHosts, reachWords, unseen } from "../hosts"
import { HostsContext, type Reach, useEngineOf, useReach } from "./hosts"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const project = (id: string) =>
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
  }) satisfies ProjectSummary

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

/** A WebSocket that only notes where it was opened to, and closes when
 * the test says. */
class Socket {
  static opened: Socket[] = []
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

test("a Pane reaches the engine of the host its args name, else of the host listing its Project; this machine's wins a clash", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, {
    seen: unseen,
    follow: () => () => undefined,
  })
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
      <HostsContext value={hosts}>
        <Pane />
      </HostsContext>
    )
    return got!
  }

  // Before the desktop tells its hosts, as after a restart: it waits.
  expect(reach("r1", "arc")).toEqual({
    host: "arc",
    shown: undefined,
    engine: undefined,
  })
  expect(reachWords("arc", undefined, hosts.seen)).toBe("Waiting for arc")

  tell([live])
  hosts.ours([project("mine")])
  hosts.projects("arc", [project("mine"), project("r1")])
  const arc = hosts.engine("arc")
  const named = reach("r1", "arc")
  expect(named.host).toBe("arc")
  expect(named.engine).toBe(arc)
  expect(reachWords("arc", named.shown, hosts.seen)).toBeUndefined()
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
  expect(reachWords("arc", gone.shown, hosts.seen)).toBe("arc is away")

  let engineOf: ReturnType<typeof useEngineOf> | undefined
  const Shell = () => {
    engineOf = useEngineOf(here)
    return null
  }
  renderToStaticMarkup(
    <HostsContext value={hosts}>
      <Shell />
    </HostsContext>
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
