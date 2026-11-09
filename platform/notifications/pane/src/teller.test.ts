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
