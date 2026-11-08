import type { Engine, ProjectId } from "@banda/contract"
import type { ThreadId, TurnId } from "@banda/contract/agents"
import { beforeEach, expect, test, vi } from "vitest"
import { presence } from "./presence"
import { seeWhenPresent } from "./session"

/** What this window's storage was told the Person saw. */
const marked = vi.hoisted((): [string, string][] => [])

vi.mock("../list/seen", async (original) => ({
  ...(await original<typeof import("../list/seen")>()),
  markSeen: (thread: string, turn: string) => void marked.push([thread, turn]),
}))

const PROJECT = "0196f000-0000-7000-8000-000000000021" as ProjectId
const THREAD = "0196f000-0000-7000-8000-000000000001" as ThreadId
const TURN = "0196f000-0000-7000-8000-000000000011" as TurnId

/** An engine in `state`, and the commands it was sent. */
function engineIn(state: string, refuses = false) {
  const sent: unknown[][] = []
  const engine = {
    status: { state },
    command: async (...asked: unknown[]) => {
      sent.push(asked)
      if (refuses) throw new Error("unknown method")
      return null
    },
  } as unknown as Engine
  return { engine, sent }
}

beforeEach(() => void marked.splice(0))

test("the mark goes to the Pane's own engine, in its Project, and stays here too", () => {
  const { engine, sent } = engineIn("open")
  seeWhenPresent(engine, PROJECT, THREAD, TURN)
  expect(sent).toEqual([
    ["agents.read", { thread: THREAD, turn: TURN }, PROJECT],
  ])
  expect(marked).toEqual([[THREAD, TURN]])
})

test("a host away is not sent the mark to keep for later; this window keeps it", () => {
  for (const state of ["connecting", "lost", "refused"]) {
    const { engine, sent } = engineIn(state)
    seeWhenPresent(engine, PROJECT, THREAD, TURN)
    expect(sent).toEqual([])
  }
  expect(marked).toHaveLength(3)
})

test("a host that refuses it, as an older one, says nothing", async () => {
  const { engine, sent } = engineIn("open", true)
  seeWhenPresent(engine, PROJECT, THREAD, TURN)
  // An unhandled refusal would fail the run.
  await Promise.resolve()
  expect(sent).toHaveLength(1)
})

test("nothing is marked until the Person is there, and nothing once called off", () => {
  const target = new EventTarget()
  const when = presence(target, () => 0)
  const first = engineIn("open")
  seeWhenPresent(first.engine, PROJECT, THREAD, TURN, when)
  expect(first.sent).toEqual([])
  target.dispatchEvent(new Event("keydown"))
  expect(first.sent).toHaveLength(1)
  expect(marked).toHaveLength(1)

  // The Pane lost the focus before the Person came back.
  const away = new EventTarget()
  const second = engineIn("open")
  const off = seeWhenPresent(
    second.engine,
    PROJECT,
    THREAD,
    TURN,
    presence(away, () => 0)
  )
  off()
  away.dispatchEvent(new Event("keydown"))
  expect(second.sent).toEqual([])
  expect(marked).toHaveLength(1)
})
