/**
 * The Panes in windows of their own (ADR 0025, decision 9): the main
 * window pops a Pane out, and it shows in a window that draws it alone,
 * the same page at `#pane/<id>`. Which Panes have one, opening and
 * closing it, and what such a Pane asks of the window are kept here and
 * nowhere else. The main window's page hears which there are each time
 * they change, and keeps each Pane's place; closing a Pane's window
 * brings it back there. The bridge's `popped` is answered here.
 *
 * They are the main window's: they close as it hides or closes, which the
 * windows say through main's root (windows.ts, `Root.closePopped`).
 *
 * A part of the device's window (ADR 0089, decision 9), over the windows
 * (windows.ts).
 */
import {
  type PoppedAsk as PoppedAskValue,
  poppedOf,
  poppedRoute,
} from "@banda/core"
import { type Answers, none, tellPage, text } from "@banda/desktop-kit"
import { Context, Effect, Layer, Schema } from "effect"
import { BrowserWindow, type WebContents } from "electron"
import { BRIDGE } from "../bridge"
import { PAGE } from "./page"
import { Windows } from "./windows"

/** What a Pane in its own window asks of the window (`PoppedAsk`). */
const PoppedAsk = Schema.Union([
  Schema.Struct({
    open: Schema.Struct({
      project: Schema.String,
      pane: Schema.Struct({
        kind: Schema.String,
        args: Schema.Record(Schema.String, Schema.MutableJson),
      }),
      from: Schema.String,
      place: Schema.optional(Schema.Literals(["right", "below", "instead"])),
    }),
  }),
  Schema.Struct({
    run: Schema.Struct({
      action: Schema.String,
      args: Schema.optional(Schema.Record(Schema.String, Schema.MutableJson)),
    }),
  }),
]) satisfies Schema.Decoder<PoppedAskValue>

export class Popped extends Context.Service<
  Popped,
  {
    /** The Panes in windows of their own now, by their IDs. */
    readonly current: () => string[]
    /** Their windows. */
    readonly windows: () => BrowserWindow[]
    /**
     * Opens Pane `pane` in a window of its own, `width` by `height`, the
     * page at `#pane/<id>` drawing it alone; or brings its window to the
     * front. The main window keeps the Pane's place; closing this one
     * brings it back. Only the main window's page (`from`) pops a Pane
     * out.
     */
    readonly open: (
      pane: string,
      width: number,
      height: number,
      from: WebContents
    ) => Effect.Effect<void>
    /** Closes Pane `pane`'s window: it is back in its place. */
    readonly close: (pane: string) => void
    /** Closes them all, back to their places. */
    readonly closeAll: () => void
    /** What a Pane in its own window (`from`) asks of the window: the
     * main window comes to the front, and its page hears it. Asked from
     * any other page, nothing. */
    readonly ask: (asked: PoppedAskValue, from: WebContents) => void
  }
>()("banda/Popped") {
  static readonly layer = Layer.effect(Popped)(
    Effect.gen(function* () {
      const windows = yield* Windows
      const popped = new Map<string, BrowserWindow>()

      /** Tells the window which Panes are in windows of their own. */
      const tell = () =>
        tellPage(windows.main()?.webContents, BRIDGE.popped.listen, [
          ...popped.keys(),
        ])

      const size = (at: number, least: number) =>
        Math.max(least, Math.min(Math.round(at) || least, 4096))

      return {
        current: () => [...popped.keys()],
        windows: () => [...popped.values()],
        open: (pane, width, height, from) =>
          Effect.suspend(() => {
            const route = poppedRoute(pane)
            if (from !== windows.main()?.webContents) return Effect.void
            if (poppedOf(route) !== pane) return Effect.void
            const shown = popped.get(pane)
            if (shown) {
              windows.inFront(shown)
              return Effect.void
            }
            return Effect.map(
              windows.page({
                width: size(width, 480),
                height: size(height, 360),
                minWidth: 320,
                minHeight: 240,
                title: "Banda",
              }),
              (opened) => {
                void opened.loadURL(`${PAGE}${route}`)
                opened.on("closed", () => {
                  popped.delete(pane)
                  tell()
                })
                popped.set(pane, opened)
                tell()
              }
            )
          }),
        close: (pane) => popped.get(pane)?.close(),
        closeAll: () => {
          for (const one of popped.values()) one.close()
        },
        ask: (asked, from) => {
          const asker = BrowserWindow.fromWebContents(from)
          if (!asker || ![...popped.values()].includes(asker)) return
          tellPage(windows.inFront()?.webContents, BRIDGE.popped.asked, asked)
        },
      }
    })
  )
}

/** Main's answers to the page's channels of `popped`. */
export const poppedAnswers: Answers<typeof BRIDGE.popped, Popped> = {
  open: [
    Schema.Tuple([Schema.String, Schema.Number, Schema.Number]),
    ([pane, width, height], event) =>
      Popped.use((popped) => popped.open(pane, width, height, event.sender)),
  ],
  close: [
    text,
    ([pane]) => Popped.use((popped) => Effect.sync(() => popped.close(pane))),
  ],
  current: [none, () => Popped.use((popped) => Effect.sync(popped.current))],
  ask: [
    Schema.Tuple([PoppedAsk]),
    ([asked], event) =>
      Popped.use((popped) =>
        Effect.sync(() => popped.ask(asked, event.sender))
      ),
  ],
}
