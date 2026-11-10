import type { Engine, ProjectId } from "@banda/contract"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, test, vi } from "vitest"
import { FORGETTING, KeptHosts, reachWords } from "../hosts"
import { away, desktop, live, project, Socket } from "../testing"
import { HostsContext, type Reach, useEngineOf, useReach } from "./hosts"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test("a Pane reaches the engine of the host its args name, else of the host listing its Project; this machine's wins a clash", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const here = { here: true } as unknown as Engine
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
  expect(reach("x")).toEqual({ engine: here })
  expect(hosts.hostOf("mine" as ProjectId, "arc")).toBeUndefined()

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
  // One the Window does not know: none to draw from, nor to act on.
  expect(reach("r1", "devbox")).toEqual({
    host: "devbox",
    shown: undefined,
    engine: undefined,
  })
  expect(() => engineOf!("r1" as ProjectId, on("devbox"))).toThrow(
    "This window does not reach devbox"
  )
  arc.close()
})
