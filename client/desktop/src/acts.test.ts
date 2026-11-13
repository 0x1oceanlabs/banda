import { vi } from "vitest"
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events")
  return { ipcMain: new EventEmitter() }
})
import { EventEmitter } from "node:events"
import { expect, it } from "@effect/vitest"
import type { WindowRequest } from "@banda/contract"
import type { ActAsk } from "@banda/core"
import { Refused, Window } from "@banda/desktop-kit"
import { Effect, Exit, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import type { BrowserWindow, WebContents } from "electron"
import { Acts, actsAsked, runOwn } from "./acts"

/** A page, and what main told it to run. */
function page(id: number, loading = false) {
  const asked: ActAsk[] = []
  const contents = Object.assign(new EventEmitter(), {
    id,
    loading,
    isDestroyed: () => false,
    isCrashed: () => false,
    isLoadingMainFrame: () => contents.loading,
    send: (channel: string, value: ActAsk) => {
      expect(channel).toBe("act.asked")
      asked.push(value)
    },
  })
  return {
    asked,
    contents: contents as unknown as WebContents & typeof contents,
  }
}

/** Main's road to the page of `window`; none while it is closed. */
const over = (window: () => { contents: WebContents } | null) =>
  Acts.layer.pipe(
    Layer.provide(
      Window.layer(() => {
        const open = window()
        return open && ({ webContents: open.contents } as BrowserWindow)
      })
    )
  )

/** What the keys module asks, as the kernel's road hands it on. */
const request = (params: unknown, within = 10_000) =>
  ({
    id: 7,
    method: "keys.act",
    project: "machine",
    by: { kind: "agent", id: "agent-1" },
    params,
    within,
  }) as unknown as WindowRequest

/** Lets the fibers forked so far run up to where they wait. */
const settled = Effect.yieldNow.pipe(Effect.repeat({ times: 10 }))

it.effect(
  "the page is told the action with its args, and once it says it ran the asker hears so",
  () => {
    const shown = page(1)
    return Effect.gen(function* () {
      const acts = yield* Acts
      const open = { action: "browser.open", args: { address: "https://a.b" } }
      const asking = yield* Effect.forkChild(actsAsked.act!(request(open)))
      yield* settled
      expect(shown.asked).toEqual([{ id: 0, ...open }])
      yield* acts.answered({ id: 0 }, shown.contents)
      expect(yield* Fiber.join(asking)).toBeUndefined()
      // An action with no args is told with none.
      const next = yield* Effect.forkChild(
        actsAsked.act!(request({ action: "overview.toggle" }))
      )
      yield* settled
      expect(shown.asked[1]).toEqual({ id: 1, action: "overview.toggle" })
      yield* acts.answered({ id: 1 }, shown.contents)
      yield* Fiber.join(next)
    }).pipe(Effect.provide(over(() => shown)))
  }
)

it.effect(
  "what the page refuses is the asker's refusal, in the page's words, and only the window's own page answers, once",
  () => {
    const shown = page(1)
    const other = page(2)
    return Effect.gen(function* () {
      const acts = yield* Acts
      const zoom = request({ action: "terminal.zoom-in" })
      const asking = yield* Effect.forkChild(Effect.exit(actsAsked.act!(zoom)))
      yield* settled
      // A Pane's own window is asked nothing, so it answers nothing.
      yield* acts.answered({ id: 0 }, other.contents)
      const refused = "terminal.zoom-in runs in the scope “terminal”."
      yield* acts.answered({ id: 0, refused }, shown.contents)
      yield* acts.answered({ id: 0 }, shown.contents)
      expect(yield* Fiber.join(asking)).toEqual(
        Exit.fail(new Refused({ message: refused }))
      )
    }).pipe(Effect.provide(over(() => shown)))
  }
)

it.effect(
  "past the asker's time the ask is forgotten, and the page's late answer is dropped",
  () => {
    const shown = page(1)
    return Effect.gen(function* () {
      const acts = yield* Acts
      const asked = request({ action: "overview.toggle" }, 1_000)
      // As the road runs a handler: within the request's time.
      const asking = yield* Effect.forkChild(
        Effect.exit(actsAsked.act!(asked).pipe(Effect.timeout(asked.within)))
      )
      yield* settled
      yield* TestClock.adjust("1 second")
      expect(Exit.isFailure(yield* Fiber.join(asking))).toBe(true)
      yield* acts.answered({ id: 0 }, shown.contents)
      // The next ask is its own: the late answer was none of its.
      const next = yield* Effect.forkChild(actsAsked.act!(asked))
      yield* settled
      yield* acts.answered({ id: 0 }, shown.contents)
      expect(next.pollUnsafe()).toBeUndefined()
      yield* acts.answered({ id: 1 }, shown.contents)
      yield* Fiber.join(next)
    }).pipe(Effect.provide(over(() => shown)))
  }
)

it.effect(
  "with no window open it is refused in the kernel's words, and an ask that names no action is refused",
  () =>
    Effect.gen(function* () {
      const act = (params: unknown) =>
        Effect.exit(actsAsked.act!(request(params)))
      expect(yield* act({ action: "overview.toggle" })).toEqual(
        Exit.fail(new Refused({ message: "Banda's window is not open." }))
      )
      expect(yield* act({ args: {} })).toEqual(
        Exit.fail(
          new Refused({ code: "invalid", message: "keys.act names no action." })
        )
      )
    }).pipe(Effect.provide(over(() => null)))
)

it.effect(
  "a window that opens now hears the action once its page has loaded, as the menu bar's row opens a Thread",
  () => {
    const shown = page(1, true)
    return Effect.gen(function* () {
      const acts = yield* Acts
      const pane = { kind: "agents.thread", args: { thread: "t1" } }
      const running = yield* Effect.forkChild(
        runOwn("pane.pick", { project: "p", pane })
      )
      yield* settled
      expect(shown.asked).toEqual([])
      shown.contents.loading = false
      shown.contents.emit("did-finish-load")
      expect(shown.asked).toEqual([
        { id: 0, action: "pane.pick", args: { project: "p", pane } },
      ])
      yield* acts.answered({ id: 0 }, shown.contents)
      yield* Fiber.join(running)
      expect(shown.contents.listenerCount("did-finish-load")).toBe(0)
    }).pipe(Effect.provide(over(() => shown)))
  }
)
