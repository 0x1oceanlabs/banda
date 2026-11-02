/** The browser's window part: its Pane, its actions and what the Banda
 * menu finds of it (ADR 0013, ADR 0022). It has no engine part, so it is
 * always on. */
import type { SpaceId } from "@banda/contract"
import { defineModule } from "@banda/ui/module"
import { paneOf } from "@banda/ui/pane"
import { fileAddress } from "./address"
import { browserPane } from "./BrowserPane"
import { webSource } from "./sources"
import { browserAt, NEW_BROWSER } from "./tabs"

export const browser = defineModule({
  id: "browser",
  engine: false,
  panes: [browserPane],
  actions: [
    {
      id: "browser.new",
      title: "New browser",
      section: "Panes",
      // As Omarchy's Super+Shift+Return.
      keys: [{ code: "Enter", alt: true, shift: true }],
      run: (window) => window.open(paneOf(browserPane, NEW_BROWSER)),
    },
    {
      // A page, or a file by its absolute path: the Banda menu's words as
      // a page, and the agents module's files there.
      id: "browser.open",
      title: "Open in a browser",
      section: "Panes",
      unlisted: true,
      run: (window, args = {}) => {
        const { address, file, space } = args
        const url =
          typeof file === "string"
            ? fileAddress(file)
            : typeof address === "string"
              ? address
              : ""
        window.open(
          paneOf(browserPane, browserAt(url)),
          typeof space === "string" ? (space as SpaceId) : undefined
        )
      },
    },
  ],
  sources: [webSource],
})
