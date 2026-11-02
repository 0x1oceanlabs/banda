/** The browser's window part: its Pane (ADR 0013, ADR 0022). It has no
 * engine part, so it is always on. */
import { defineModule } from "@banda/ui/module"
import { paneOf } from "@banda/ui/pane"
import { browserPane } from "./BrowserPane"
import { NEW_BROWSER } from "./tabs"

export { browserPane }
export { fileAddress, isAddress, useAddressOf } from "./address"
export { type BrowserArgs, browserAt, type Tab } from "./tabs"

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
  ],
})
