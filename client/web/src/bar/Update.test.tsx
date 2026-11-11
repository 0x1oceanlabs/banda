// @vitest-environment happy-dom
/**
 * The bar's update waits on this machine's terminals as well as its
 * Threads (ADR 0106, decision 4): held from `terminal.running`, per
 * Project, only while a version is ready; no restart until every Project
 * answered, and none while one runs a program in front.
 */
import { type Engine, Refused } from "@banda/contract"
import type { Update } from "@banda/core"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { UpdateWidget } from "./Update"
import { IDLE_FOR } from "./updating"

const READY = {
  name: "Banda",
  have: "0.2.0",
  always: false,
  state: "ready",
  version: "0.3.0",
  notes: [],
  waits: true,
} as Update

/** `engine` with the Projects `projects` lists; what each stream heard. */
function engineOf(projects: string[], fails = false) {
  const streams = new Map<
    string,
    { hear: (running: { terminals: number }) => void; end: () => void }
  >()
  let stopped = 0
  const session = {
    call: (method: string) => {
      if (method !== "projects.list") return Promise.resolve(null)
      if (fails)
        return Promise.reject(
          new Refused({ code: "internal", message: "no list" })
        )
      return Promise.resolve(projects.map((id) => ({ id })))
    },
    stream: (
      project: string,
      method: string,
      _params: unknown,
      hear: (running: { terminals: number }) => void,
      end: () => void
    ) => {
      expect(method).toBe("terminal.running")
      streams.set(project, { hear, end })
      return () => {
        stopped++
        streams.delete(project)
      }
    },
  } as unknown as Engine
  return { session, streams, stopped: () => stopped }
}

let root: ReturnType<typeof createRoot> | undefined
let restart: ReturnType<typeof vi.fn>
let tell: (update: Update) => void = () => {}

beforeEach(() => {
  vi.useFakeTimers()
  restart = vi.fn()
  ;(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  ;(window as unknown as { banda: unknown }).banda = {
    update: {
      current: () => Promise.resolve(READY),
      listen: (hear: (update: Update) => void) => {
        tell = hear
        return () => {}
      },
      restart,
    },
  }
})

afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ""
  vi.useRealTimers()
})

/** The widget mounted with `working` Threads at work. */
async function mount(session: Engine, working = 0) {
  const element = document.createElement("div")
  document.body.append(element)
  root = createRoot(element)
  await act(async () =>
    root!.render(<UpdateWidget engine={session} working={working} />)
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  return element
}

const pass = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

test("it holds no stream before a version is ready, and lets go of it once none waits", async () => {
  const { session, streams, stopped } = engineOf(["p"])
  await mount(session)
  expect([...streams.keys()]).toEqual(["p"])
  await act(async () => tell({ ...READY, state: "none" } as Update))
  await pass(0)
  expect(streams.size).toBe(0)
  expect(stopped()).toBe(1)
})

test("it does not restart until every Project has answered", async () => {
  const { session, streams } = engineOf(["p", "q"])
  await mount(session)
  await act(async () => streams.get("p")!.hear({ terminals: 0 }))
  await pass(IDLE_FOR + 100)
  expect(restart).not.toHaveBeenCalled()
  await act(async () => streams.get("q")!.hear({ terminals: 0 }))
  await pass(IDLE_FOR + 100)
  expect(restart).toHaveBeenCalledTimes(1)
})

test("a program in front holds the restart, and the wait is over once it is gone", async () => {
  const { session, streams } = engineOf(["p", "q"])
  await mount(session)
  await act(async () => streams.get("p")!.hear({ terminals: 1 }))
  await act(async () => streams.get("q")!.hear({ terminals: 0 }))
  await pass(IDLE_FOR + 100)
  expect(restart).not.toHaveBeenCalled()
  await act(async () => streams.get("p")!.hear({ terminals: 0 }))
  await pass(IDLE_FOR - 100)
  expect(restart).not.toHaveBeenCalled()
  await pass(200)
  expect(restart).toHaveBeenCalledTimes(1)
})

test("a stream its engine refuses counts as none, so an older engine holds no update", async () => {
  const { session, streams } = engineOf(["p"])
  await mount(session)
  await act(async () => streams.get("p")!.end())
  await pass(IDLE_FOR + 100)
  expect(restart).toHaveBeenCalledTimes(1)
})

test("a list refused holds no update for ever", async () => {
  const { session } = engineOf(["p"], true)
  await mount(session)
  await pass(IDLE_FOR + 100)
  expect(restart).toHaveBeenCalledTimes(1)
})

test("Threads at work hold the restart whatever the terminals say", async () => {
  const { session, streams } = engineOf(["p"])
  await mount(session, 1)
  await act(async () => streams.get("p")!.hear({ terminals: 0 }))
  await pass(IDLE_FOR + 100)
  expect(restart).not.toHaveBeenCalled()
})
