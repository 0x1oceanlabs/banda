import {
  type CommandCall,
  Engine,
  Lost,
  newId,
  type ProjectId,
  type ProjectSummary,
  Refused,
  type Status,
  Unreachable,
} from "@banda/contract"
import { afterEach, expect, test, vi } from "vitest"
import { FORGETTING, KeptHosts, type Shown, shownOf } from "./hosts"
import {
  type Back,
  type DeviceStorage,
  inMemory,
  KEEP,
  KEEPS,
  type NewWait,
  onDevice,
  type Sender,
  type StorageEvents,
  Waiting,
  waitsFor,
} from "./queue"
import { HERE } from "./pane"
import { away, desktop, live, project, Socket } from "./testing"

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
 * says its window was refused; it notes each one's `not_after` as an
 * engine that heard no pong says it. */
function held() {
  const sent: { command: string; notAfter?: number }[] = []
  const settles: { ok: () => void; fail: (error: Error) => void }[] = []
  const connection = { status: { state: "open" } as Status }
  const engine: Sender = {
    get status() {
      return connection.status
    },
    commandAt: ((_m, _p, _project, command, options) => {
      const notAfter =
        options?.notAfter === undefined
          ? undefined
          : options.notAfter + (options.ahead ?? 0)
      sent.push({ command: command!, notAfter })
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

test("a message is queued for the machine that has its Pane, which the queue works out: none for this machine's, and its Project is kept as that machine lists it (ADR 0106, law 6)", () => {
  const listed = { id: PROJECT, name: "banda" } as ProjectSummary
  const waiting = new Waiting(inMemory(), {
    // The Window's directory: one Project on arc, the rest here.
    placed: (project) => (project === PROJECT ? "arc" : undefined),
    summary: (host, project) =>
      host === "arc" && project === PROJECT ? listed : undefined,
  })
  const here = "0196f000-0000-7000-8000-000000000022" as ProjectId
  expect(waiting.add({ ...message("stays"), project: here })).toBe(false)
  expect(waiting.get()).toEqual([])

  expect(waiting.add({ ...message("goes"), shows: { to: "Claude" } })).toBe(
    true
  )
  expect(waiting.get()).toMatchObject([
    { host: "arc", text: "goes", shows: { to: "Claude", project: listed } },
  ])
  // While arc lists nothing, as away since the window began, what a
  // message to it kept before is what the next keeps.
  const unlisted = new Waiting(inMemory(), { placed: () => "arc" })
  unlisted.add({ ...message("first"), shows: { project: listed } })
  unlisted.add({ ...message("second", newId()), shows: { to: "Claude" } })
  expect(unlisted.get()[1]).toMatchObject({ shows: { project: listed } })
  waiting.close()
  unlisted.close()
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
    item: THREAD,
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
  expect(JSON.parse([...storage.read().values()][0]!)).toMatchObject({
    going: true,
  })
  first.close()
  const again = new Waiting(storage)
  again.start()
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

/** A device's storage, as a browser keeps it for the windows on it: each
 * hears what another changes, a moment after, never what it changes
 * itself. `broken` makes it refuse every read and write. */
function aDevice() {
  const kept = new Map<string, string>()
  const windows: Set<(event: { key: string | null }) => void>[] = []
  let broken = false
  const shut = () => {
    if (broken) throw new Error("The storage is shut.")
  }
  return {
    kept,
    break: () => void (broken = true),
    /** A window on the device: its queue, the main window's if it
     * `drains`, named arc's machine "arc", started. */
    window(drains: boolean, more: { ahead?: () => number } = {}) {
      const heard = new Set<(event: { key: string | null }) => void>()
      windows.push(heard)
      const tell = (key: string) => {
        for (const other of windows)
          if (other !== heard)
            for (const hear of [...other])
              void Promise.resolve().then(() => hear({ key }))
      }
      const storage: DeviceStorage = {
        get length() {
          shut()
          return kept.size
        },
        key: (i) => [...kept.keys()][i] ?? null,
        getItem: (key) => kept.get(key) ?? null,
        setItem: (key, value) => {
          shut()
          if (kept.get(key) === value) return
          kept.set(key, value)
          tell(key)
        },
        removeItem: (key) => {
          shut()
          if (kept.delete(key)) tell(key)
        },
      }
      const events: StorageEvents = {
        addEventListener: (_, listener) => void heard.add(listener),
        removeEventListener: (_, listener) => void heard.delete(listener),
      }
      const waiting = new Waiting(
        onDevice(() => storage, events),
        { named: () => "arc", drains, ...more }
      )
      waiting.start()
      return waiting
    },
  }
}

/** Lets what a window heard from another reach it. */
const heard = () => vi.advanceTimersByTimeAsync(0)

test("one queue for this device's windows: a message queued in a Pane's own window shows in the main window, which alone sends it, once; it stays as that window closes", async () => {
  vi.useFakeTimers({ now: at1432 })
  const device = aDevice()
  const main = device.window(true)
  const popped = device.window(false)
  const command = newId()
  popped.add(message("from its own window", command))
  await heard()
  expect(main.get()).toEqual([
    expect.objectContaining({ text: "from its own window", seq: 1 }),
  ])
  expect(popped.get()).toEqual(
    main.get().map((one) => expect.objectContaining(one))
  )

  // Only the main window sends, and once.
  const { engine, sent, settles } = held()
  popped.send("arc", engine)
  expect(sent).toEqual([])
  main.send("arc", engine)
  main.send("arc", engine)
  expect(sent.map((one) => one.command)).toEqual([command])
  await heard()
  expect(popped.get()[0]).toMatchObject({ going: true })
  settles[0]!.ok()
  await heard()
  expect(main.get()).toEqual([])
  expect(popped.get()).toEqual([])

  // Queued there as that window closes, as its Pane docks back: it waits
  // here, in the order queued.
  popped.add(message("first", newId()))
  popped.add(message("second", newId()))
  popped.close()
  await heard()
  expect(main.get().map((one) => one.text)).toEqual(["first", "second"])
  // What it kept of the window it was went with it.
  expect(
    [...device.kept.keys()].filter((key) => key.includes("window."))
  ).toEqual([])
  main.close()
})

test("an Edit in a Pane's own window holds the main window: the message neither goes nor comes back until it is saved, as that window says every 20 s for 5 minutes, longer than a hidden window's clock sleeps; one held by a window that broke goes within them", async () => {
  vi.useFakeTimers({ now: at1432 })
  const device = aDevice()
  const main = device.window(true)
  const popped = device.window(false)
  const back = hearing(main)
  const { engine, sent } = held()
  const command = newId()
  popped.add(message("8 shards", command))
  const release = popped.hold(command)
  await heard()
  main.send("arc", engine)
  expect(sent).toEqual([])
  const holds = () =>
    [...device.kept]
      .filter(([key]) => key.includes("window."))
      .map(([, text]) => JSON.parse(text).held[command])
  expect(holds()).toEqual([Date.now() + 5 * 60_000])
  await vi.advanceTimersByTimeAsync(20_000)
  expect(holds()).toEqual([Date.now() + 5 * 60_000])
  // Past its time while it is edited there: it waits for the edit.
  await vi.advanceTimersByTimeAsync(KEEP + 30_000)
  expect(back).toEqual([])
  popped.edit(command, "4 shards", {
    ...popped.get()[0]!.call,
    params: { ...popped.get()[0]!.call.params, text: "4 shards" },
  } as CommandCall)
  release()
  await heard()
  expect(back).toEqual([
    expect.objectContaining({
      wait: expect.objectContaining({ text: "4 shards" }),
      why: { kind: "expired" },
    }),
  ])

  // A window that broke as it held one says no more: its hold lapses
  // within 5 minutes, and the message goes.
  const late = newId()
  main.add(message("held there", late, Date.now()))
  device.kept.set(
    "banda.waiting.window.gone",
    JSON.stringify({
      at: Date.now(),
      held: { [late]: Date.now() + 5 * 60_000 },
      shows: [],
    })
  )
  main.add(message("nudge", newId(), Date.now()))
  main.send("arc", engine)
  expect(sent.map((one) => one.command)).not.toContain(late)
  await vi.advanceTimersByTimeAsync(4 * 60_000)
  main.send("arc", engine)
  expect(sent.map((one) => one.command)).not.toContain(late)
  await vi.advanceTimersByTimeAsync(60_000)
  main.send("arc", engine)
  expect(sent.map((one) => one.command)).toContain(late)
  popped.close()
  main.close()
})

test("past its time, it comes back once, to the window that shows its Thread, whose composer has the draft; where that window does not take it, the main window does", async () => {
  vi.useFakeTimers({ now: at1432 })
  const device = aDevice()
  const main = device.window(true)
  const popped = device.window(false)
  const inMain: Back[] = []
  main.onBack((one) => inMain.push(one) > 0)
  const there: Back[] = []
  const pane = popped.onBack((one) => there.push(one) > 0, { item: THREAD })
  popped.add(message("only in its own window"))
  await heard()
  await vi.advanceTimersByTimeAsync(KEEP)
  await heard()
  expect(there).toEqual([
    {
      wait: expect.objectContaining({ text: "only in its own window" }),
      why: { kind: "expired" },
      machine: "arc",
    },
  ])
  expect(main.get()).toEqual([])
  await vi.advanceTimersByTimeAsync(10_000)
  expect(inMain).toEqual([])
  expect(there).toHaveLength(1)
  expect([...device.kept.keys()].some((key) => key.includes("told."))).toBe(
    false
  )

  // Shown in the main window too, it is the main window's alone.
  const here = main.onBack(() => false, { item: THREAD })
  main.add(message("shown here too", newId(), Date.now()))
  await vi.advanceTimersByTimeAsync(KEEP)
  await heard()
  expect(inMain.map((one) => one.wait.text)).toEqual(["shown here too"])
  expect(there).toHaveLength(1)
  here()

  // Its Pane gone from that window, as it docks back: the main window.
  pane()
  main.add(message("its Pane docked", newId(), Date.now()))
  await vi.advanceTimersByTimeAsync(KEEP)
  await heard()
  expect(inMain.at(-1)).toMatchObject({ wait: { text: "its Pane docked" } })
  expect(there).toHaveLength(1)

  // A window that says it shows the Thread, but broke: the main window
  // takes it after a while, once.
  popped.close()
  device.kept.set(
    "banda.waiting.window.gone",
    JSON.stringify({ at: Date.now(), held: {}, shows: [THREAD] })
  )
  main.add(message("to a window gone", newId(), Date.now()))
  await vi.advanceTimersByTimeAsync(KEEP)
  expect(inMain.at(-1)).toMatchObject({ wait: { text: "its Pane docked" } })
  await vi.advanceTimersByTimeAsync(5_000)
  expect(inMain.filter((one) => one.wait.text === "to a window gone")).toEqual([
    expect.objectContaining({ why: { kind: "expired" } }),
  ])
  main.close()

  // Handed to a window that did not take it as the main window went: the
  // next one takes it, once.
  device.kept.set(
    "banda.waiting.told.x",
    JSON.stringify({ to: "gone", back: inMain.at(-1) })
  )
  const last = device.window(true)
  const backAgain = hearing(last)
  await vi.advanceTimersByTimeAsync(5_000)
  expect(backAgain).toEqual([
    expect.objectContaining({
      wait: expect.objectContaining({ text: "to a window gone" }),
    }),
  ])
  await vi.advanceTimersByTimeAsync(5_000)
  expect(backAgain).toHaveLength(1)
  last.close()
})

test("after a restart, what waits is still there: one that was on its way may have gone through and goes again as it is; one past its time comes back, never sent; one whose machine is live goes at once, once, by its ID and its host's time as queued", async () => {
  vi.useFakeTimers({ now: at1432 })
  const device = aDevice()
  // arc's clock is 2 s ahead, as its last pong said.
  const first = device.window(true, { ahead: () => 2_000 })
  const going = newId()
  const short = newId()
  const waits = newId()
  first.add(message("on its way", going))
  first.add({ ...message("for a minute", short), keep: 60_000 })
  first.add({ ...message("for an hour", waits), keep: KEEPS[1]!.for })
  expect(first.get().map((one) => one.notAfter - one.until)).toEqual([
    2_000, 2_000, 2_000,
  ])
  const before = held()
  first.send("arc", before.engine)
  expect(before.sent).toHaveLength(3)
  before.settles[1]!.fail(new Unreachable("arc", "arc is away"))
  before.settles[2]!.fail(new Unreachable("arc", "arc is away"))
  await heard()
  // The window goes, as one quits, with the first on its way.
  first.close()

  // Started again 5 minutes on, arc live; its engine heard no pong yet.
  vi.setSystemTime(at1432 + 5 * 60_000)
  const again = device.window(true)
  const back = hearing(again)
  await heard()
  expect(back).toEqual([
    expect.objectContaining({
      wait: expect.objectContaining({ text: "for a minute" }),
      why: { kind: "expired" },
    }),
  ])
  expect(again.get()).toEqual([
    expect.objectContaining({ text: "on its way", went: true }),
    expect.objectContaining({ text: "for an hour" }),
  ])
  const after = held()
  again.send("arc", after.engine)
  again.send("arc", after.engine)
  expect(after.sent).toEqual([
    { command: going, notAfter: at1432 + KEEP + 2_000 },
    { command: waits, notAfter: at1432 + 60 * 60_000 + 2_000 },
  ])
  after.settles.forEach((one) => one.ok())
  await heard()
  expect(again.get()).toEqual([])
  expect([...device.kept.keys()]).toEqual([])
  again.close()
})

test("what comes back before the Window hears, as a window starts again, leaves the storage only once taken: a window that goes before it hears leaves it to the next, which takes it once", async () => {
  vi.useFakeTimers({ now: at1432 })
  const device = aDevice()
  const first = device.window(true)
  const command = newId()
  first.add(message("past its time while closed", command))
  first.close()

  // Started again an hour on: it comes back before the Window hears, and
  // that window goes before it does.
  vi.setSystemTime(at1432 + 60 * 60_000)
  const unheard = device.window(true)
  await heard()
  expect(unheard.get()).toEqual([])
  expect([...device.kept.keys()]).toEqual([`banda.waiting.told.${command}`])
  unheard.close()

  // The next takes it as it hears, once.
  const next = device.window(true)
  const back = hearing(next)
  expect(back).toEqual([
    {
      wait: expect.objectContaining({ text: "past its time while closed" }),
      why: { kind: "expired" },
      machine: "arc",
    },
  ])
  await vi.advanceTimersByTimeAsync(10_000)
  expect(back).toHaveLength(1)
  expect([...device.kept.keys()]).toEqual([])
  next.close()
})

test("after a restart, a message goes in its host's time as it was queued until its engine hears a pong, and by that pong once it does, never by both: one that goes after its engine was quiet, which asks first", async () => {
  vi.useFakeTimers({ now: at1432 })
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  // Queued as arc's clock was 2 minutes behind, as its last pong said.
  const storage = inMemory()
  const before = new Waiting(storage, { ahead: () => -120_000 })
  const command = newId()
  before.add({ ...message("after the edit", command), keep: KEEPS[1]!.for })
  before.close()

  // Started again, arc live; its engine is open, but heard no pong, and
  // an Edit holds the message past the engine's quiet.
  const { device, tell } = desktop()
  const hosts = new KeptHosts(device, FORGETTING, undefined, {
    waiting: storage,
  })
  const stop = hosts.follow()
  const release = hosts.waiting.hold(command)
  tell([live])
  await vi.advanceTimersByTimeAsync(0)
  const socket = Socket.opened[0]!
  socket.say(opened)
  await vi.advanceTimersByTimeAsync(8_000)
  expect(hosts.engine("arc").offset).toBeUndefined()
  expect(callsOn(socket)).toEqual([])

  // Let go, it goes; its engine asks first, and the pong says the same.
  release()
  await vi.advanceTimersByTimeAsync(0)
  const ping = socket.sent.findLast(({ type }) => type === "ping")!
  socket.say({ type: "pong", id: ping.id, time: Date.now() - 120_000 })
  await vi.advanceTimersByTimeAsync(0)
  expect(hosts.engine("arc").offset).toBe(-120_000)
  const [call] = callsOn(socket)
  expect(callsOn(socket)).toEqual([
    expect.objectContaining({
      command,
      not_after: at1432 + 60 * 60_000 - 120_000,
    }),
  ])
  socket.say({ type: "result", id: call!.id, ok: { thread: THREAD } })
  await vi.advanceTimersByTimeAsync(0)
  expect(hosts.waiting.get()).toEqual([])
  stop()
  hosts.engine("arc").close()
})

test("a storage that fails keeps what waits in memory, for the window's life", async () => {
  vi.useFakeTimers({ now: at1432 })
  const device = aDevice()
  device.break()
  const main = device.window(true)
  main.add(message("kept here"))
  expect(main.get()).toEqual([expect.objectContaining({ text: "kept here" })])
  const command = main.get()[0]!.call.command
  main.keepFor(command, KEEPS[1]!.for)
  expect(main.get()[0]).toMatchObject({ until: at1432 + 60 * 60_000 })
  const { engine, sent } = held()
  main.send("arc", engine)
  expect(sent).toHaveLength(1)
  expect(device.kept.size).toBe(0)
  main.close()
})

test("what is kept that is no message, as one broken or of another build, is let go as the main window starts", async () => {
  vi.useFakeTimers({ now: at1432 })
  const device = aDevice()
  device.kept.set("banda.waiting.message.x", "{not json")
  device.kept.set(
    "banda.waiting.message.y",
    JSON.stringify({ text: "an older build's" })
  )
  device.kept.set("banda.agents.draft.t1", "a draft")
  const main = device.window(true)
  expect(main.get()).toEqual([])
  expect([...device.kept.keys()]).toEqual(["banda.agents.draft.t1"])
  main.close()
})

test("a message waits while this machine's engine restarts, and a Pane closed meanwhile too: both go once it is back, the close first", async () => {
  vi.useFakeTimers({ now: at1432 })
  vi.stubGlobal("WebSocket", Socket)
  Socket.opened = []
  const { device } = desktop()
  const words = "Banda is restarting on this machine"
  // Its own connection says whether it answers.
  const here = new Engine(
    async () => ({ url: "ws://127.0.0.1:1/here", secret: "s3cr3t" }),
    { staleOnLoss: true, unreachable: () => new Unreachable(HERE, words) }
  )
  const hosts = new KeptHosts(device, FORGETTING, here)
  hosts.follow()
  hosts.ours([project(PROJECT)], "m0" as ProjectId)
  await vi.advanceTimersByTimeAsync(0)
  Socket.opened[0]!.say(opened)
  expect(hosts.shown(HERE)).toMatchObject({ state: { state: "live" } })
  expect(waitsFor(hosts.shown(HERE), here.status.state)).toBe(false)

  // Its engine goes: this machine is away, and what is sent now waits.
  Socket.opened[0]!.close()
  expect(hosts.shown(HERE)).toMatchObject({
    state: { state: "away", why: words },
    asOf: at1432,
  })
  expect(waitsFor(hosts.shown(HERE), here.status.state)).toBe(true)
  await expect(
    hosts
      .sessionOf(PROJECT, undefined, { drawn: true })
      .command("projects.create", { name: "Not now" })
  ).rejects.toMatchObject({ name: "Unreachable", message: words })
  const pane = { kind: "agents.thread", args: { thread: THREAD } }
  const command = newId()
  expect(
    hosts.waiting.add({ ...message("once you are back", command), pane })
  ).toBe(true)
  expect(hosts.waiting.get()).toMatchObject([
    { host: HERE, text: "once you are back" },
  ])
  const terminal = { kind: "terminal.terminal", args: { terminal: "t1" } }
  hosts.left.add({
    host: HERE,
    boot: hosts.bootOf(HERE),
    project: PROJECT,
    pane: terminal,
  })
  const order: string[] = []
  hosts.onLeft((one, engine) => {
    expect(engine).toBe(here)
    order.push(`closed ${String(one.pane.args.terminal)}`)
  })

  // It tries again by itself, and is back under the same boot.
  await vi.advanceTimersByTimeAsync(250)
  const socket = Socket.opened[1]!
  expect(callsOn(socket)).toEqual([])
  socket.say(opened)
  await vi.advanceTimersByTimeAsync(0)
  order.push(...callsOn(socket).map((call) => `sent ${call.command}`))
  expect(order).toEqual(["closed t1", `sent ${command}`])
  expect(hosts.left.get()).toEqual([])
  expect(hosts.shown(HERE)).toMatchObject({ state: { state: "live" } })
})
