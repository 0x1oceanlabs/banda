import type { ProjectId } from "@banda/contract"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"
import { inWindow } from "../directory"
import { FORGETTING, KeptHosts, reachWords } from "../hosts"
import { away, desktop, live, ownEngine, project, Socket } from "../testing"
import {
  HostsContext,
  type Reach,
  useEngineOf,
  usePlaced,
  useReach,
} from "./hosts"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test("a Pane reaches the engine of the host listing its Project, else of the one its old args name; this machine's wins a clash, and one no machine has reaches none", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const here = ownEngine().engine
  const hosts = new KeptHosts(device, FORGETTING, here)
  hosts.follow()
  /** What a Pane of `project`, its args naming host `named`, reaches. */
  const reach = (project: string, named?: string) => {
    let got: Reach | undefined
    const Pane = () => {
      got = useReach(project as ProjectId, named)
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
  expect(hosts.hostOf("mine" as ProjectId, "arc")).toBeUndefined()
  // A Project no machine the Window knows has: none, never this
  // machine's engine in its place (ADR 0106, decision 1).
  expect(reach("x")).toEqual({ host: null })

  let engineOf: ReturnType<typeof useEngineOf> | undefined
  const Shell = () => {
    engineOf = useEngineOf()
    return null
  }
  renderToStaticMarkup(
    <HostsContext value={hosts}>
      <Shell />
    </HostsContext>
  )
  expect(engineOf!("r1" as ProjectId)).toBe(arc)
  expect(engineOf!("mine" as ProjectId)).toBe(here)
  // An act goes by the host its args name, never this machine's engine
  // in its place, but for a clash.
  const on = (host: string) => ({ kind: "agents.thread", args: { host } })
  expect(engineOf!("gone" as ProjectId, on("arc"))).toBe(arc)
  expect(engineOf!("mine" as ProjectId, on("arc"))).toBe(here)

  // Away, the Pane keeps its engine, which catches up as the host
  // returns; an act there is refused at once, in the pill's words.
  tell([away])
  const gone = reach("r1", "arc")
  expect(gone.engine).toBe(arc)
  expect(reachWords("arc", gone.shown, hosts.seen)).toBe("arc is away")
  expect(() => engineOf!("r1" as ProjectId, on("arc"))).toThrow("arc is away")
  // The listing wins over what old args name.
  expect(reach("r1", "devbox").host).toBe("arc")
  // A host the Window does not know: none to draw from, nor to act on.
  expect(reach("x", "devbox")).toEqual({
    host: "devbox",
    shown: undefined,
    engine: undefined,
  })
  expect(() => engineOf!("x" as ProjectId, on("devbox"))).toThrow(
    "This window does not reach devbox"
  )
  expect(() => engineOf!("x" as ProjectId)).toThrow(
    "This window does not reach that machine"
  )
  arc.close()
})

test("a Pane restored while its machine is away reaches that machine by the directory the device kept, and says it is away, not this machine's refusal", () => {
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const kept = inWindow()
  const here = ownEngine().engine
  // The window before: arc listed "r1".
  const before = desktop()
  const first = new KeptHosts(before.device, FORGETTING, here, {
    directory: kept,
  })
  first.follow()
  before.tell([live])
  first.ours([project("mine")])
  first.projects("arc", [project("r1")])

  // Started again with arc away from its first moment: its Pane, whose
  // args name no host, is arc's.
  const after = desktop()
  const hosts = new KeptHosts(after.device, FORGETTING, here, {
    directory: kept,
  })
  hosts.follow()
  after.tell([away])
  let got: Reach | undefined
  const placed: Record<string, ReturnType<typeof usePlaced>> = {}
  const Pane = () => {
    got = useReach("r1" as ProjectId, undefined)
    placed.arc = usePlaced("r1" as ProjectId, undefined)
    placed.mine = usePlaced("mine" as ProjectId, undefined)
    placed.none = usePlaced("x" as ProjectId, undefined)
    return null
  }
  hosts.ours([project("mine")])
  renderToStaticMarkup(
    <HostsContext value={hosts}>
      <Pane />
    </HostsContext>
  )
  expect(got!.host).toBe("arc")
  expect(got!.engine).toBe(hosts.engine("arc"))
  expect(reachWords("arc", got!.shown, hosts.seen)).toBe("arc is away")
  // What an App reads of it, the same machine and no engine; nothing for
  // this machine's or for one no machine has.
  expect(placed.arc!.host).toBe("arc")
  expect(placed.arc!.shown).toBe(got!.shown)
  expect(placed.arc).not.toHaveProperty("engine")
  expect(placed.mine).toEqual({})
  expect(placed.none).toEqual({})
  hosts.engine("arc").close()
})
