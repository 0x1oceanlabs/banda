import {
  type CommandCall,
  Lost,
  newId,
  type ProjectId,
  Refused,
  type Status,
  Unreachable,
} from "@banda/contract"
import { afterEach, expect, test, vi } from "vitest"
import { FORGETTING, KeptHosts, type Shown, shownOf } from "./hosts"
import {
  type Back,
  inMemory,
  KEEP,
  KEEPS,
  type NewWait,
  type Sender,
  Waiting,
  waitsFor,
} from "./queue"
import { away, desktop, live, Socket } from "./testing"

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const PROJECT = "0196f000-0000-7000-8000-000000000021" as ProjectId
const THREAD = "0196f000-0000-7000-8000-000000000001"
const at1432 = new Date(2026, 10, 10, 14, 32, 0).getTime()

/** A message to arc's Thread, sent as `command`, with `text`. */
const message = (text: string, command = newId(), at = at1432): NewWait => ({
  call: {
    method: "agents.send",
    params: { thread: THREAD, text, images: [], settings: null, steer: false },
    command,
  } as CommandCall,
  host: "arc",
  project: PROJECT,
  item: THREAD,
  text,
  pane: { kind: "agents.thread", args: { thread: THREAD, host: "arc" } },
  at,
})

/** What the queue gives back, as an App hears it. */
function hearing(waiting: Waiting) {
  const back: Back[] = []
  waiting.onBack((one) => back.push(one) > 0)
  return back
}

/** A sender each command of which the test settles, open until the test
 * says its window was refused. */
function held() {
  const sent: { command: string; notAfter?: number }[] = []
  const settles: { ok: () => void; fail: (error: Error) => void }[] = []
  const connection = { status: { state: "open" } as Status }
  const engine: Sender = {
    get status() {
      return connection.status
    },
    commandAt: ((_m, _p, _project, command, options) => {
      sent.push({ command: command!, notAfter: options?.notAfter })
      return new Promise((resolve, reject) =>
        settles.push({
          ok: () => resolve({ answer: null, at: null } as never),
          fail: reject,
        })
      )
    }) as Sender["commandAt"],
  }
  return { engine, sent, settles, connection }
}

type Frame = { type: string; id: number; command?: string; not_after?: number }
const callsOn = (socket: Socket) =>
  (socket.sent as Frame[]).filter(({ type }) => type === "call")

const opened = { type: "welcome", engine: "0.1.0", modules: [], boot: "b1" }

test("a message waits while arc is away and goes once it is back, by the ID it was queued with and its time in arc's clock; on its way as arc goes again, it may have gone through and goes again by that ID", async () => {
  vi.useFakeTimers({ now: at1432 })
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, FORGETTING)
  hosts.follow()
  tell([live])
  const engine = hosts.engine("arc")
  await vi.advanceTimersByTimeAsync(0)
  Socket.opened[0]!.say(opened)
  // Its pong says arc's clock is 2 s ahead.
  await vi.advanceTimersByTimeAsync(15_000)
  const ping = Socket.opened[0]!.sent.find(({ type }) => type === "ping")!
  Socket.opened[0]!.say({ type: "pong", id: ping.id, time: Date.now() + 2_000 })
  expect(engine.offset).toBe(2_000)
  vi.setSystemTime(at1432)
  tell([away])
  const back = hearing(hosts.waiting)

  // Queued while arc is away: nothing goes.
  const command = newId()
  hosts.waiting.add(message("and run them again with 8 shards", command))
  const [wait] = hosts.waiting.get()
  expect(wait).toMatchObject({ until: at1432 + KEEP })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(callsOn(Socket.opened[0]!)).toEqual([])

  // arc back: it goes as its engine is open, once, by its ID; its time
  // in arc's clock.
  tell([live])
  await vi.advanceTimersByTimeAsync(0)
  const socket = Socket.opened[1]!
  expect(callsOn(socket)).toEqual([])
  socket.say(opened)
  await vi.advanceTimersByTimeAsync(0)
  const [first] = callsOn(socket)
  expect(callsOn(socket)).toHaveLength(1)
  expect(first).toMatchObject({ command, not_after: at1432 + KEEP + 2_000 })
  expect(hosts.waiting.get()[0]).toMatchObject({ going: true })

  // arc goes again before it answers: it may have gone through, and
  // waits, to go again as it is.
  tell([away])
  await vi.advanceTimersByTimeAsync(0)
  expect(hosts.waiting.get()).toEqual([expect.objectContaining({ went: true })])
  expect(hosts.waiting.get()[0]).not.toHaveProperty("going")
  // As it is: no Edit, no Keep for.
  hosts.waiting.edit(command, "other", {
    ...wait!.call,
    params: { thread: THREAD, text: "other" },
  } as CommandCall)
  hosts.waiting.keepFor(command, KEEPS[1]!.for)
  expect(hosts.waiting.get()[0]).toMatchObject({
    text: "and run them again with 8 shards",
    until: at1432 + KEEP,
  })

  // Back again: it goes again by the same ID, and answered, it is gone,
  // saying nothing.
  tell([live])
  await vi.advanceTimersByTimeAsync(0)
  const again = Socket.opened[2]!
  again.say(opened)
  await vi.advanceTimersByTimeAsync(0)
  const sent = callsOn(again)
  expect(sent.map((frame) => frame.command)).toEqual([command])
  again.say({ type: "result", id: sent[0]!.id, ok: { thread: THREAD } })
  await vi.advanceTimersByTimeAsync(0)
  expect(hosts.waiting.get()).toEqual([])
  expect(back).toEqual([])
  engine.close()
  hosts.waiting.close()
})

test("past its time, a message is not sent: it comes back expired, and one that went as its machine went comes back as one that may have gone through", async () => {
  vi.useFakeTimers({ now: at1432 })
  const waiting = new Waiting(inMemory(), { named: () => "arc" })
  const back = hearing(waiting)
  waiting.add(message("first"))
  waiting.add(message("kept an hour", newId()))
  waiting.keepFor(waiting.get()[1]!.call.command, KEEPS[1]!.for)
  expect(waiting.get()[1]).toMatchObject({ until: at1432 + 60 * 60_000 })
  // At 14:42, arc still away: the first comes back, never sent.
  await vi.advanceTimersByTimeAsync(KEEP - 1)
  expect(back).toEqual([])
  await vi.advanceTimersByTimeAsync(1)
  expect(back).toEqual([
    {
      wait: expect.objectContaining({ text: "first" }),
      why: { kind: "expired" },
      machine: "arc",
    },
  ])
  expect(waiting.get().map((wait) => wait.text)).toEqual(["kept an hour"])

  // One past its time as arc is back is not sent either.
  const { engine, sent, settles } = held()
  vi.setSystemTime(at1432 + 60 * 60_000)
  waiting.send("arc", engine)
  expect(sent).toEqual([])
  expect(back.map(({ why }) => why)).toEqual([
    { kind: "expired" },
    { kind: "expired" },
  ])

  // One on its way waits for its host's answer past its time; gone with
  // arc, it may have gone through, and comes back so.
  waiting.add(message("on its way", newId(), Date.now()))
  waiting.send("arc", engine)
  expect(sent).toHaveLength(1)
  await vi.advanceTimersByTimeAsync(KEEP + 1)
  expect(waiting.get()).toHaveLength(1)
  settles[0]!.fail(new Unreachable("arc", "arc is away").sent())
  await vi.advanceTimersByTimeAsync(0)
  expect(back.at(-1)).toMatchObject({
    wait: { text: "on its way" },
    why: { kind: "went" },
  })
  expect(waiting.get()).toEqual([])
  waiting.close()
})

test("a message its host refuses comes back: expired by the host's clock, as one that may have gone through where its run there was cut short, or in its words; refused unsent it waits as it was, and lost on its way, or the window refused after it went, it may have gone through", async () => {
  vi.useFakeTimers({ now: at1432 })
  const waiting = new Waiting(inMemory(), { named: () => "arc" })
  const back = hearing(waiting)
  const { engine, sent, settles, connection } = held()
  for (const text of ["expired", "cut short", "gone", "unsent", "lost"])
    waiting.add(message(text))
  waiting.send("arc", engine)
  // In the order queued, each by its time.
  expect(sent.map(({ notAfter }) => notAfter)).toEqual(
    Array(5).fill(at1432 + KEEP)
  )
  settles[0]!.fail(
    new Refused({ code: "expired", message: "Its time had passed." })
  )
  // Its receipt there began and was never answered, as a restart leaves
  // it: never "Not sent".
  settles[1]!.fail(
    new Refused({
      code: "may_have_run",
      message: "This command ended before it answered, and may have run.",
    })
  )
  settles[2]!.fail(
    new Refused({ code: "not_found", message: "There is no such Thread." })
  )
  settles[3]!.fail(new Unreachable("arc", "arc is away"))
  settles[4]!.fail(new Lost())
  await vi.advanceTimersByTimeAsync(0)
  expect(back.map(({ wait, why }) => [wait.text, why])).toEqual([
    ["expired", { kind: "expired" }],
    ["cut short", { kind: "went" }],
    ["gone", { kind: "refused", message: "There is no such Thread." }],
  ])
  expect(waiting.get()).toEqual([
    expect.not.objectContaining({ went: true, going: true }),
    expect.objectContaining({ text: "lost", went: true }),
  ])
  expect(waiting.get()[0]).toMatchObject({ text: "unsent" })

  // Gone again after a break and refused as the window is, as arc updated
  // meanwhile: it may have gone through, and waits, not "Not sent".
  waiting.add(message("refused after", newId(), Date.now()))
  waiting.send("arc", engine)
  connection.status = {
    state: "refused",
    refusal: { code: "protocol", message: "Update Banda." },
  }
  settles.at(-1)!.fail(new Refused(connection.status.refusal))
  await vi.advanceTimersByTimeAsync(0)
  expect(back).toHaveLength(3)
  expect(waiting.get().at(-1)).toMatchObject({
    text: "refused after",
    went: true,
  })
  waiting.close()
})

test("a message held while its row is edited neither goes nor comes back: let go, it goes with its new words, or comes back with them past its time", async () => {
  vi.useFakeTimers({ now: at1432 })
  const waiting = new Waiting(inMemory(), { named: () => "arc" })
  const back = hearing(waiting)
  const { engine, sent } = held()
  const command = newId()
  waiting.add(message("8 shards", command))
  const edited = (text: string) =>
    ({
      ...waiting.get()[0]!.call,
      params: { ...waiting.get()[0]!.call.params, text },
    }) as CommandCall

  // arc back while it is edited: it waits for the words typed.
  const release = waiting.hold(command)
  waiting.send("arc", engine)
  expect(sent).toEqual([])
  expect(waiting.edit(command, "4 shards", edited("4 shards"))).toBe(true)
  // Two Panes on its Thread hold it apart.
  const other = waiting.hold(command)
  release()
  release()
  waiting.send("arc", engine)
  expect(sent).toEqual([])
  other()
  waiting.send("arc", engine)
  expect(sent).toEqual([expect.objectContaining({ command })])
  expect(waiting.get()[0]).toMatchObject({ text: "4 shards", going: true })
  // On its way, it changes no more.
  expect(waiting.edit(command, "2 shards", edited("2 shards"))).toBe(false)

  // Past its time while it is edited: it comes back once let go, with
  // the words typed.
  const late = newId()
  waiting.add(message("first words", late))
  const letGo = waiting.hold(late)
  await vi.advanceTimersByTimeAsync(KEEP + 1)
  expect(back).toEqual([])
  waiting.edit(late, "new words", {
    ...waiting.get()[1]!.call,
    params: { ...waiting.get()[1]!.call.params, text: "new words" },
  } as CommandCall)
  letGo()
  await vi.advanceTimersByTimeAsync(0)
  expect(back).toEqual([
    expect.objectContaining({
      wait: expect.objectContaining({ text: "new words" }),
      why: { kind: "expired" },
    }),
  ])
  waiting.close()
})

test("Edit changes a message's words and keeps its time and ID; Keep for counts from Send, 7 days at most; Cancel takes it back unless it is on its way", () => {
  vi.useFakeTimers({ now: at1432 })
  const waiting = new Waiting()
  const command = newId()
  waiting.add(message("first words", command))
  const [wait] = waiting.get()
  vi.setSystemTime(at1432 + 5 * 60_000)
  const call = {
    ...wait!.call,
    params: { ...wait!.call.params, text: "new words" },
  } as CommandCall
  waiting.edit(command, "new words", call)
  expect(waiting.get()[0]).toMatchObject({
    text: "new words",
    call: { command, params: { text: "new words" } },
    at: at1432,
    until: at1432 + KEEP,
  })
  // Another ID is not this one's.
  waiting.edit(command, "other", { ...call, command: newId() })
  expect(waiting.get()[0]!.text).toBe("new words")
  waiting.keepFor(command, KEEPS[2]!.for)
  expect(waiting.get()[0]!.until).toBe(at1432 + 24 * 60 * 60_000)
  waiting.keepFor(command, 30 * 24 * 60 * 60_000)
  expect(waiting.get()[0]!.until).toBe(at1432 + 7 * 24 * 60 * 60_000)
  expect(KEEPS.map((keep) => keep.words)).toEqual([
    "10 min",
    "1 hour",
    "1 day",
    "7 days",
  ])

  // On its way, it is not taken back.
  const { engine } = held()
  waiting.send("arc", engine)
  expect(waiting.cancel(command)).toBeUndefined()
  const other = newId()
  waiting.add(message("taken back", other))
  expect(waiting.cancel(other)).toMatchObject({ text: "taken back" })
  expect(waiting.get().map((one) => one.text)).toEqual(["new words"])
  waiting.close()
})

test("what comes back goes to the Window first, to a Pane only where none takes it, and waits for one where none hears", async () => {
  vi.useFakeTimers({ now: at1432 })
  const waiting = new Waiting(inMemory(), { named: () => "arc" })
  waiting.add(message("before anyone heard"))
  await vi.advanceTimersByTimeAsync(KEEP)
  const pane: string[] = []
  const stop = waiting.onBack((one) => pane.push(one.wait.text) > 0, {
    after: true,
  })
  expect(pane).toEqual(["before anyone heard"])
  const windows: string[] = []
  waiting.onBack((one) => windows.push(one.wait.text) > 0)
  waiting.add(message("with a Window", newId(), Date.now()))
  await vi.advanceTimersByTimeAsync(KEEP)
  expect(windows).toEqual(["with a Window"])
  expect(pane).toEqual(["before anyone heard"])
  stop()
  waiting.close()
})

test("what was kept as on its way may have gone through, as the window starts again", () => {
  const storage = inMemory()
  const first = new Waiting(storage)
  first.add({ ...message("kept"), at: Date.now() })
  first.send("arc", held().engine)
  expect(storage.read()[0]).toMatchObject({ going: true })
  first.close()
  const again = new Waiting(storage)
  expect(again.get()).toEqual([expect.objectContaining({ went: true })])
  expect(again.get()[0]).not.toHaveProperty("going")
  again.close()
})

test("a message to a started Thread waits while its machine is away, stopped or refused, as another build is, or live while its engine refused this window; not while it connects or asks for a sign-in", () => {
  const shown = (state: Shown["state"]): Shown => shownOf(undefined, state, 0)
  const host = { name: "arc", ssh: "arc" }
  expect(waitsFor(shown(away), "away")).toBe(true)
  expect(waitsFor(shown({ ...host, state: "stopped" }), "away")).toBe(true)
  expect(
    waitsFor(
      shown({
        ...host,
        state: "refused",
        why: "Banda there is of another build, which does not speak this one's protocol",
      }),
      "away"
    )
  ).toBe(true)
  expect(waitsFor(shown(live), "refused")).toBe(true)
  expect(waitsFor(shown(live), "open")).toBe(false)
  expect(waitsFor(shown(live), "connecting")).toBe(false)
  expect(waitsFor(shown({ ...host, state: "connecting" }), "away")).toBe(false)
  expect(
    waitsFor(
      shown({ ...host, state: "signin", url: "https://login.tailscale.com/x" }),
      "away"
    )
  ).toBe(false)
  // Not known yet, as before the desktop first tells the hosts.
  expect(waitsFor(undefined, "connecting")).toBe(false)
})
