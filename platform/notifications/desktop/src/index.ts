/**
 * The notifications module's part in the window's main process (ADR 0028,
 * ADR 0056, decision 1): it answers the module's channels of the bridge,
 * showing the desktop's notifications (notices.ts). A click on one brings
 * Banda's window to the front and tells its page which. The end-to-end
 * tests get a recorded desktop instead (`BANDA_DESKTOP=recorded`).
 */
import { NOTIFY_BRIDGE } from "@banda/notifications-pane/desktop"
import {
  type DesktopModule,
  none,
  tellPage,
  text,
  Window,
} from "@banda/desktop-kit"
import { NodeServices } from "@effect/platform-node"
import { Effect, Layer, Schema } from "effect"
import { NoticeArg, Notices, RecordedDesktop } from "./notices"

export { RecordedDesktop } from "./notices"

/**
 * Where the notices go: the desktop's notification server, or, for the
 * end-to-end tests, a list they read through `globalThis.bandaDesktop`.
 */
const layer =
  process.env.BANDA_DESKTOP === "recorded"
    ? Notices.recorded(
        ((globalThis as { bandaDesktop?: RecordedDesktop }).bandaDesktop =
          new RecordedDesktop())
      )
    : // It asks Omarchy whether it is quiet with a program of its own.
      Notices.system.pipe(Layer.provide(NodeServices.layer))

export const notificationsDesktop: DesktopModule<
  typeof NOTIFY_BRIDGE,
  Notices,
  Window
> = {
  layer,
  answers: {
    show: [
      Schema.Tuple([NoticeArg]),
      ([notice]) =>
        Effect.gen(function* () {
          const window = yield* Window
          // A click brings the window to the front, and its page goes to
          // what the notice told of.
          const answered = (key: string) => {
            const shown = window.now()
            if (!shown) return
            if (shown.isMinimized()) shown.restore()
            shown.show()
            shown.focus()
            tellPage(shown.webContents, NOTIFY_BRIDGE.listen, key)
          }
          yield* Notices.use((notices) => notices.show(notice, answered))
          // The workspace that holds the window lights up in the
          // desktop's bar.
          const shown = window.now()
          if (shown && !shown.isFocused()) shown.flashFrame(true)
        }),
    ],
    withdraw: [
      text,
      ([key]) => Notices.use((notices) => notices.withdraw(key)),
    ],
    quiet: [none, () => Notices.use((notices) => notices.quiet)],
  },
  asked: {},
  served: {},
  opened: () => Effect.void,
}
