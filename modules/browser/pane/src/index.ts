/** The browser's window part: its Pane (ADR 0013, ADR 0022). It has no
 * engine part, so it is always on. */
import { defineModule } from "@banda/ui/module"
import { browserPane } from "./BrowserPane"

export { browserPane }
export { fileAddress, isAddress, useAddressOf } from "./address"
export { type BrowserArgs, browserAt, NEW_BROWSER, type Tab } from "./tabs"

export const browser = defineModule({
  id: "browser",
  engine: false,
  panes: [browserPane],
})
