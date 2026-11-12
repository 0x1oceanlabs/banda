import type { Notify } from "@banda/contract/look"
import { toast } from "@banda/ui/components/sonner"
import { type Here, Store } from "@banda/core/react"
import type { Thing, WindowApi } from "@banda/ui/module"
import type { Listed, Lists } from "@banda/ui/pane"
import { DEFAULT_SOUND } from "@banda/ui/sound"
import { afterEach, expect, test, vi } from "vitest"
import { GATHER } from "./sound"
import { startTelling } from "./teller"

const NOTIFY: Notify = {
  system: "away",
  window: "out-of-sight",
  detail: true,
  quiet: "desktop",
  done: true,
  asking: true,
  failed: true,
  problems: true,
}

const done = (id: string): Listed => ({
  id,
  title: id,
  mark: "done",
  changed: 0,
  pane: { kind: "agents.thread", args: { thread: id } },
})

/** Here, the Window in front, with the Pane in focus showing `subject`. */
const at = (subject: string): Here => ({
  front: true,
  sidebar: false,
  workspace: { id: "w", project: "p" },
  pane: { id: subject, project: "p", subject },
  project: "p",
  starts: "p",
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test("a call the Person looks at while it gathers is not told, though they look away before the moment ends", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("document", {
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => run())
  const items = new Store<Lists>({ p: [] })
  const here = new Store<Here>(at("elsewhere"))
  // The Window's sight, from Here alone: the focused Pane's thing is
  // looked at, any other is in the window.
  const sight = (thing?: Thing) =>
    thing && here.get().pane?.subject === thing.about ? "looking" : "in-window"
  const window = {
    items,
    here,
    sight,
    look: () => ({ notify: NOTIFY, sound: DEFAULT_SOUND }),
    quiet: () => false,
    projects: () => [],
    run: () => {},
  } as unknown as WindowApi
  const teller = startTelling(window)

  // A Thread ends. Alt+U goes to it and, within the moment calls
  // gather, on to the next, as the Tiling draws each before the engine
  // answers (#903): it is not told.
  items.set({ p: [done("t1")] })
  here.set(at("t1"))
  here.set(at("t2"))
  await vi.advanceTimersByTimeAsync(GATHER)
  expect(toast.getToasts()).toEqual([])

  // One the Person never looks at is.
  items.set({ p: [done("t1"), done("t3")] })
  await vi.advanceTimersByTimeAsync(GATHER)
  expect(toast.getToasts().map((one) => one.id)).toEqual(["p:t3"])
  teller.stop()
  toast.dismiss()
})

// ADR 0098, decision 21: while Quiet is on, a Thread that ends is told
// nowhere, and a module's news neither; as Quiet ends nothing is played
// back, and the next call is told as ever.
test("while Quiet is on nothing is told, and as it ends nothing is played back", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("document", {
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => run())
  const items = new Store<Lists>({ p: [] })
  let quiet = true
  const window = {
    items,
    here: new Store<Here>(at("elsewhere")),
    sight: () => "in-window",
    look: () => ({ notify: NOTIFY, sound: DEFAULT_SOUND }),
    quiet: () => quiet,
    projects: () => [],
    run: () => {},
  } as unknown as WindowApi
  const teller = startTelling(window)

  items.set({ p: [done("t1")] })
  await vi.advanceTimersByTimeAsync(GATHER)
  await teller.told({
    key: "problems",
    kind: "failed",
    title: "Broke",
    buttons: [],
  })
  expect(toast.getToasts()).toEqual([])

  // Quiet ends just after a call came: it is not told then either.
  items.set({ p: [done("t1"), done("t2")] })
  quiet = false
  await vi.advanceTimersByTimeAsync(GATHER)
  expect(toast.getToasts()).toEqual([])

  items.set({ p: [done("t1"), done("t2"), done("t3")] })
  await vi.advanceTimersByTimeAsync(GATHER)
  expect(toast.getToasts().map((one) => one.id)).toEqual(["p:t3"])
  teller.stop()
  toast.dismiss()
})

// ADR 0098, decision 18: what a machine out of reach did meanwhile comes
// in one list as it is heard again, and is told of nowhere; what it does
// after that is told as ever.
test("a machine back from away updates its calls silently, and what comes after is told", async () => {
  vi.useFakeTimers()
  vi.stubGlobal("document", {
    addEventListener: () => {},
    removeEventListener: () => {},
  })
  vi.stubGlobal("requestAnimationFrame", (run: () => void) => run())
  const working = (id: string): Listed => ({
    ...done(id),
    mark: "working",
    host: "arc",
  })
  const items = new Store<Lists>({ r: [working("t1"), working("t2")] })
  const window = {
    items,
    here: new Store<Here>(at("elsewhere")),
    sight: () => "in-window",
    look: () => ({ notify: NOTIFY, sound: DEFAULT_SOUND }),
    quiet: () => false,
    projects: () => [],
    run: () => {},
  } as unknown as WindowApi
  const teller = startTelling(window)
  const away = (one: Listed): Listed => ({ ...one, away: true })

  // arc goes away; back, both ended while it was away: nothing is told.
  items.set({ r: [away(working("t1")), away(working("t2"))] })
  items.set({
    r: [
      { ...done("t1"), host: "arc" },
      { ...done("t2"), host: "arc" },
    ],
  })
  await vi.advanceTimersByTimeAsync(GATHER)
  expect(toast.getToasts()).toEqual([])

  // The next that ends there is told.
  items.set({
    r: [
      { ...done("t1"), host: "arc" },
      { ...done("t2"), host: "arc" },
      { ...done("t3"), host: "arc" },
    ],
  })
  await vi.advanceTimersByTimeAsync(GATHER)
  expect(toast.getToasts().map((one) => one.id)).toEqual(["r:t3"])
  teller.stop()
  toast.dismiss()
})
