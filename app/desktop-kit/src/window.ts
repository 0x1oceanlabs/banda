/**
 * Banda's window, for the services that show something over it or tell
 * its page something (ADR 0020). Main opens and closes it, and gives this
 * layer, which only says which it is now.
 */
import { Context, Layer } from "effect"
import type { BrowserWindow } from "electron"

export class Window extends Context.Service<
  Window,
  {
    /** The window now; none while it is closed. */
    now(): BrowserWindow | null
  }
>()("banda/Window") {
  static readonly layer = (now: () => BrowserWindow | null) =>
    Layer.succeed(Window)({ now })
}
