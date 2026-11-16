/**
 * A browser page's sideways swipes in main (ADR 0025): those the page
 * had no use for, its preload tells of (`passSwipes`), and they go to the
 * window, whose Strip moves by them. Those a page hears while Banda's
 * hands act in it are theirs, and stay there: only the Person's gesture
 * moves the window (ADR 0083, decision 3).
 */
import { BROWSER_BRIDGE, SWIPE_CHANNEL } from "@banda/browser-pane/desktop"
import { tellPage } from "@banda/desktop-kit"
import { Option, Schema } from "effect"
import type { WebContents } from "electron"

const decode = Schema.decodeUnknownOption(
  Schema.Tuple([Schema.Finite, Schema.Finite])
)

/** Sends the swipes `page` passes on to `window`. A page's own frame
 * tells them, none inside it. */
export function swipes(
  page: WebContents,
  window: WebContents,
  byHands: (page: number) => boolean
): void {
  page.ipc.on(SWIPE_CHANNEL, (event, ...sent: unknown[]) => {
    if (event.senderFrame !== page.mainFrame || byHands(page.id)) return
    const swiped = Option.getOrUndefined(decode(sent))
    if (!swiped) return
    const [deltaX, deltaY] = swiped
    tellPage(window, BROWSER_BRIDGE.swipe, { page: page.id, deltaX, deltaY })
  })
}
