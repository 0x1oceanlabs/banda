import type { Engine, ProjectId, Status } from "@banda/contract"
import type { ThreadId, TurnId } from "@banda/contract/agents"
import { beforeEach, expect, test, vi } from "vitest"
import { presence } from "./presence"

const said = vi.hoisted(() => ({ errors: [] as string[] }))
vi.mock("@banda/ui/components/sonner", () => ({
  toast: { error: (words: string) => void said.errors.push(words) },
}))

const { seeWhenPresent } = await import("./session")
const { mark, sendingTo } = await import("../list/sent")

const PROJECT = "0196f000-0000-7000-8000-000000000021" as ProjectId
const THREAD = "0196f000-0000-7000-8000-000000000001" as ThreadId
const TURN = "0196f000-0000-7000-8000-000000000011" as TurnId

/** What the window's own seen sends. */
const SEEN = ["agents.read", { thread: THREAD, turn: TURN }, PROJECT]

/** How the host answers a command: it takes it, refuses it as an older
 * host does, or holds it on its way. */
type Answers = "takes" | "refuses" | "holds"

/** An engine in `state`, and the commands it was sent; `go` changes its
 * state, as a connection that breaks and comes back. */
function engineIn(state: Status["state"], answers: Answers = "takes") {
  const sent: unknown[][] = []
  const watchers = new Set<(status: Status) => void>()
  let status = { state } as Status
  const engine = {
    get status() {
      return status
    },
    watch: (watcher: (status: Status) => void) => {
      watchers.add(watcher)
      watcher(status)
      return () => void watchers.delete(watcher)
    },
    commandAt: async (method: string, params: unknown, project: string) => {
      sent.push([method, params, project])
      if (answers === "refuses") throw new Error("unknown method")
      if (answers === "holds") return new Promise(() => undefined)
      return { answer: null, at: 7 }
    },
  } as unknown as Engine
  const go = (state: Status["state"]) => {
    status = { state } as Status
    for (const watcher of [...watchers]) watcher(status)
  }
  /** Whether anything still watches its status. */
  const watched = () => watchers.size > 0
  return { engine, sent, go, watched }
}

/** Lets a mark's answer come, and what follows it run. */
const answered = () => new Promise((done) => setTimeout(done))

beforeEach(() => void (said.errors = []))

test("the mark goes to the Pane's own engine, in its Project, and shows at once", () => {
  const { engine, sent } = engineIn("open")
  seeWhenPresent(engine, PROJECT, THREAD, TURN)
  expect(sent).toEqual([SEEN])
  expect(sendingTo(engine)[THREAD]?.seen?.to).toBe(TURN)
})

test("a host away is not sent the mark to keep for later, and none shows", () => {
  for (const state of ["connecting", "lost", "refused"] as const) {
    const { engine, sent } = engineIn(state)
    seeWhenPresent(engine, PROJECT, THREAD, TURN)
    expect(sent).toEqual([])
    expect(sendingTo(engine)).toEqual({})
  }
  expect(said.errors).toEqual([])
})

test("a seen not sent as its host was away goes once the host is back, and once only", async () => {
  for (const away of ["connecting", "lost"] as const) {
    const { engine, sent, go, watched } = engineIn(away)
    seeWhenPresent(engine, PROJECT, THREAD, TURN)
    await answered()
    go("connecting")
    expect(sent).toEqual([])
    go("open")
    expect(sent).toEqual([SEEN])
    expect(sendingTo(engine)[THREAD]?.seen?.to).toBe(TURN)
    await answered()
    // Taken, it is done: another break sends it no more.
    expect(watched()).toBe(false)
    go("lost")
    go("open")
    expect(sent).toEqual([SEEN])
  }
  expect(said.errors).toEqual([])
})

test("a seen whose host went while it was on its way goes again once the host is back", async () => {
  const { engine, sent, go } = engineIn("open", "holds")
  seeWhenPresent(engine, PROJECT, THREAD, TURN)
  expect(sent).toEqual([SEEN])
  go("lost")
  await answered()
  expect(sendingTo(engine)).toEqual({})
  go("open")
  expect(sent).toEqual([SEEN, SEEN])
  expect(said.errors).toEqual([])
})

test("a host that refuses it, as an older one, says nothing, and is not sent it again as it comes back", async () => {
  const { engine, sent, go, watched } = engineIn("open", "refuses")
  seeWhenPresent(engine, PROJECT, THREAD, TURN)
  await vi.waitFor(() => expect(sendingTo(engine)).toEqual({}))
  await answered()
  expect(watched()).toBe(false)
  go("lost")
  go("open")
  expect(sent).toEqual([SEEN])
  expect(said.errors).toEqual([])
})

test("a seen the Person took back with Mark as unread stays so as the host comes back", async () => {
  const { engine, sent, go } = engineIn("open")
  seeWhenPresent(engine, PROJECT, THREAD, TURN)
  await answered()
  expect(await mark(engine, PROJECT, THREAD, { seen: null })).toBe(true)
  go("lost")
  go("open")
  await answered()
  expect(sent).toEqual([SEEN, ["agents.unread", { thread: THREAD }, PROJECT]])
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

test("armed again as its host is back, the seen waits for the Person, and nothing once called off", async () => {
  let now = 0
  const target = new EventTarget()
  const when = presence(target, () => now)
  const { engine, sent, go, watched } = engineIn("lost")
  seeWhenPresent(engine, PROJECT, THREAD, TURN, when)
  // The Person is there while the host is away: nothing is sent.
  target.dispatchEvent(new Event("keydown"))
  await answered()
  expect(sent).toEqual([])
  // They left before the host came back.
  now = 120_000
  go("open")
  expect(sent).toEqual([])
  target.dispatchEvent(new Event("keydown"))
  expect(sent).toEqual([SEEN])

  // Called off while the host is away, or while it waits for the Person:
  // nothing goes, and nothing watches the host.
  for (const back of [false, true]) {
    const other = engineIn("lost")
    const off = seeWhenPresent(other.engine, PROJECT, THREAD, TURN, when)
    await answered()
    if (back) {
      now += 120_000
      other.go("open")
    }
    off()
    expect(other.watched()).toBe(false)
    other.go("open")
    target.dispatchEvent(new Event("keydown"))
    expect(other.sent).toEqual([])
  }
  expect(watched()).toBe(false)
})
