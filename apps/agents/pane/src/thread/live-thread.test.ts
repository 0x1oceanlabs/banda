import type { Engine, ProjectId } from "@banda/contract"
import type { Item, ThreadView } from "@banda/contract/agents"
import { afterEach, expect, test, vi } from "vitest"
import { agent, event } from "../testing"
import { follow, readThread } from "./live-thread"
import { EMPTY } from "./state"

afterEach(() => {
  vi.restoreAllMocks()
})

/** An engine whose Thread holds entries of these kinds, by their IDs. */
function engineWith(kinds: Record<string, string>): Engine {
  const items = Object.entries(kinds).map(
    ([id, kind]) =>
      ({
        id,
        author: agent,
        at: 0,
        body: { kind, text: "" },
      }) as unknown as Item
  )
  const view: ThreadView = {
    at: 0,
    thread: { title: "", harness: "fake" } as ThreadView["thread"],
    items,
    turns: [],
    settings: EMPTY.settings,
    offer: EMPTY.offer,
    held: false,
  }
  return { call: async () => view } as unknown as Engine
}

const project = "p" as ProjectId

test("a read that left entries out says so once in the window's log, naming their kinds", async () => {
  const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  const engine = engineWith({
    a: "subagent",
    m: "message",
    b: "crew",
    c: "subagent",
  })
  const read = await readThread(engine, project, "t")
  expect(read.items.map((item) => item.id)).toEqual(["m"])
  expect(warned.mock.calls).toEqual([
    [
      "agents: left out entries of kinds this window does not know: subagent, crew",
    ],
  ])
})

test("a read that left nothing out says nothing", async () => {
  const warned = vi.spyOn(console, "warn").mockImplementation(() => undefined)
  const read = await readThread(engineWith({ m: "message" }), project, "t")
  expect(read.items.map((item) => item.id)).toEqual(["m"])
  expect(warned).not.toHaveBeenCalled()
})

const fence = { fence: "missing", why: "off", words: "BANDA_FENCE=off" }

test("a turn Banda kept Supervised says why and when, which the Person's next choice keeps", () => {
  const said = event("thread.configured", {
    thread: "t",
    settings: { mode: "supervised", options: {} },
    supervised: { before: true, fence },
  })
  const kept = follow(EMPTY, said)
  expect(kept.settings.mode).toBe("supervised")
  expect(kept.supervised).toEqual({ before: true, fence, at: said.at })
  const chosen = follow(
    kept,
    event("thread.configured", {
      thread: "t",
      settings: { mode: "full_access", options: {} },
    })
  )
  expect(chosen.settings.mode).toBe("full_access")
  expect(chosen.supervised).toEqual(kept.supervised)
  // What the Pane already followed is not heard again.
  expect(follow(chosen, said)).toBe(chosen)
})
