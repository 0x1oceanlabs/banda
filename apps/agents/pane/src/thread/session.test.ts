import type { Engine, ProjectId } from "@banda/contract"
import type { ThreadId, TurnId } from "@banda/contract/agents"
import { beforeEach, expect, test, vi } from "vitest"
import { presence } from "./presence"

const said = vi.hoisted(() => ({ errors: [] as string[] }))
vi.mock("@banda/ui/components/sonner", () => ({
  toast: { error: (words: string) => void said.errors.push(words) },
}))

const { seeWhenPresent } = await import("./session")
const { sendingTo } = await import("../list/sent")

const PROJECT = "0196f000-0000-7000-8000-000000000021" as ProjectId
const THREAD = "0196f000-0000-7000-8000-000000000001" as ThreadId
const TURN = "0196f000-0000-7000-8000-000000000011" as TurnId

/** An engine in `state`, and the commands it was sent. */
function engineIn(state: string, refuses = false) {
  const sent: unknown[][] = []
  const engine = {
    status: { state },
    watch: () => () => undefined,
    commandAt: async (method: string, params: unknown, project: string) => {
      sent.push([method, params, project])
      if (refuses) throw new Error("unknown method")
      return { answer: null, at: 7 }
    },
  } as unknown as Engine
  return { engine, sent }
}

beforeEach(() => void (said.errors = []))

test("the mark goes to the Pane's own engine, in its Project, and shows at once", () => {
  const { engine, sent } = engineIn("open")
  seeWhenPresent(engine, PROJECT, THREAD, TURN)
  expect(sent).toEqual([
    ["agents.read", { thread: THREAD, turn: TURN }, PROJECT],
  ])
  expect(sendingTo(engine)[THREAD]?.seen?.to).toBe(TURN)
})

test("a host away is not sent the mark to keep for later, and none shows", () => {
  for (const state of ["connecting", "lost", "refused"]) {
    const { engine, sent } = engineIn(state)
    seeWhenPresent(engine, PROJECT, THREAD, TURN)
    expect(sent).toEqual([])
    expect(sendingTo(engine)).toEqual({})
  }
  expect(said.errors).toEqual([])
})

test("a host that refuses it, as an older one, says nothing", async () => {
  const { engine, sent } = engineIn("open", true)
  seeWhenPresent(engine, PROJECT, THREAD, TURN)
  await vi.waitFor(() => expect(sendingTo(engine)).toEqual({}))
  expect(sent).toHaveLength(1)
  expect(said.errors).toEqual([])
})

test("nothing is marked until the Person is there, and nothing once called off", () => {
  const target = new EventTarget()
  const when = presence(target, () => 0)
  const first = engineIn("open")
  seeWhenPresent(first.engine, PROJECT, THREAD, TURN, when)
  expect(first.sent).toEqual([])
  target.dispatchEvent(new Event("keydown"))
  expect(first.sent).toHaveLength(1)

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
  expect(sendingTo(second.engine)).toEqual({})
})
