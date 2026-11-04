import { vi } from "vitest"
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events")
  return { ipcMain: new EventEmitter() }
})
import { EventEmitter } from "node:events"
import { expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import type { WebContents } from "electron"
import { Dialogs } from "./dialogs"
import { Tabs } from "./tabs"

it.effect(
  "native callbacks are answered once; stale IDs cannot answer a replacement",
  () =>
    Effect.gen(function* () {
      const news: unknown[] = []
      const tabs = Layer.succeed(Tabs)({
        all: () => [],
        changes: undefined as never,
        attached: () => {},
        create: () => Effect.never,
        created: () => Effect.void,
        tell: (value) => {
          news.push(value)
        },
      })
      yield* Effect.gen(function* () {
        const dialogs = yield* Dialogs
        const page = Object.assign(new EventEmitter(), {
          id: 7,
          isDestroyed: () => false,
          debugger: new EventEmitter(),
        })
        const native = () => {
          throw new Error("Native window must not open")
        }
        page.on("-run-dialog", native)
        dialogs.attached(page as unknown as WebContents)
        const answers: unknown[] = []
        const open = () =>
          page.emit(
            "-run-dialog",
            {
              dialogType: "confirm",
              messageText: "Name?",
              defaultPromptText: "Roma",
              frame: { url: "https://example.com/" },
            },
            (...args: unknown[]) => answers.push(args)
          )
        open()
        yield* Effect.yieldNow
        const first = dialogs.current(7)!
        yield* dialogs.answer(7, first.id, true)
        expect(answers).toEqual([[true, "Roma"]])
        open()
        yield* Effect.yieldNow
        const second = dialogs.current(7)!
        expect(second.id).not.toBe(first.id)
        const stale = yield* Effect.flip(dialogs.answer(7, first.id, false))
        expect(stale.code).toBe("conflict")
        expect(dialogs.current(7)?.id).toBe(second.id)
        yield* dialogs.answer(7, second.id, false)
        expect(answers).toEqual([
          [true, "Roma"],
          [false, "Roma"],
        ])
        open()
        yield* Effect.yieldNow
        page.emit("-cancel-dialogs")
        yield* Effect.yieldNow
        expect(dialogs.current(7)).toBeNull()
        expect(answers).toHaveLength(3)
        expect(news).toHaveLength(6)
      }).pipe(Effect.provide(Dialogs.layer.pipe(Layer.provide(tabs))))
    })
)

it.effect(
  "the sandboxed prompt returns empty text or null, and rejects other senders",
  () =>
    Effect.gen(function* () {
      const { ipcMain } = yield* Effect.promise(() => import("electron"))
      const { PROMPT_CHANNEL } = yield* Effect.promise(
        () => import("@banda/browser-pane/desktop")
      )
      const tabs = Layer.succeed(Tabs)({
        all: () => [],
        changes: undefined as never,
        attached: () => {},
        create: () => Effect.never,
        created: () => Effect.void,
        tell: () => {},
      })
      yield* Effect.gen(function* () {
        const dialogs = yield* Dialogs
        const page = Object.assign(new EventEmitter(), {
          id: 8,
          isDestroyed: () => false,
          debugger: new EventEmitter(),
        })
        dialogs.attached(page as unknown as WebContents)
        const event = {
          sender: page,
          senderFrame: { url: "https://example.com/" },
          returnValue: undefined as unknown,
        }
        ipcMain.emit(PROMPT_CHANNEL, event, "Gift?", "Default")
        yield* Effect.yieldNow
        expect(event.returnValue).toBeUndefined()
        yield* dialogs.answer(8, dialogs.current(8)!.id, true, "")
        expect(event.returnValue).toBe("")
        ipcMain.emit(PROMPT_CHANNEL, event, "Gift?", "Default")
        yield* Effect.yieldNow
        yield* dialogs.answer(8, dialogs.current(8)!.id, false)
        expect(event.returnValue).toBeNull()
        const outsider = {
          sender: { id: 99 },
          returnValue: undefined as unknown,
        }
        ipcMain.emit(PROMPT_CHANNEL, outsider, "Gift?", "Default")
        yield* Effect.yieldNow
        expect(outsider.returnValue).toBeNull()
        expect(dialogs.current(99)).toBeNull()
      }).pipe(Effect.provide(Dialogs.layer.pipe(Layer.provide(tabs))))
    })
)
