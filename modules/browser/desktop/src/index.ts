/**
 * The browser's part in the window's main process (ADR 0013, ADR 0028):
 * its services as one layer, which needs main's window, look, settings
 * and engine (@banda/desktop-kit); its answers to the bridge's
 * `browser` channels and to what its engine part asks (ADR 0029); and
 * what it does as Banda's window opens.
 */
import type { BROWSER_BRIDGE } from "@banda/browser-pane/desktop"
import type {
  DesktopModule,
  Engine,
  Look,
  Settings,
  Window,
} from "@banda/desktop-kit"
import { Layer } from "effect"
import type { WebContents } from "electron"
import { browserAsked } from "./asked"
import { Browser, browserAnswers, userAgent } from "./browser"
import { Cdp } from "./cdp"
import { Drive } from "./drive"
import { Extensions } from "./extensions"
import { Tabs } from "./tabs"

export const browserDesktop: DesktopModule<
  typeof BROWSER_BRIDGE,
  Browser | Cdp | Drive | Extensions | Tabs,
  Window | Look | Settings | Engine
> = {
  layer: Drive.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(Browser.layer, Cdp.layer(userAgent))),
    Layer.provideMerge(Extensions.layer),
    Layer.provideMerge(Tabs.layer)
  ),
  answers: browserAnswers,
  asked: browserAsked,
  // Banda's page may show browser pages, and nothing else.
  opened: (contents: WebContents) =>
    Browser.use((browser) => browser.host(contents)),
}
