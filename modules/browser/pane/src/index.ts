/** The browser's window part: its Pane, its actions and what the Banda
 * menu finds of it (ADR 0013, ADR 0022). It has no engine part, so it is
 * always on. */
import type { SpaceId } from "@banda/contract"
import { defineModule } from "@banda/ui/module"
import { paneOf, type PaneState } from "@banda/ui/pane"
import { fileAddress } from "./address"
import { browserPane } from "./BrowserPane"
import { frontHolder, holderOf, openWith } from "./pages"
import { webSource } from "./sources"
import { browserAt, type KeptArgs, NEW_BROWSER, readArgs } from "./tabs"

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
  // A tab an Agent opens goes beside its Thread (ADR 0029, decision 4):
  // to the browser of the column right of the Thread's Pane, or a new
  // one there; with the Thread not shown, to its Space's browser the
  // Person was in last, or a new one. An extension's goes to the browser
  // the Person was in last. The Person's Pane keeps the focus.
  start: (window) =>
    openWith((url, agent) => {
      const at = agent ? window.beside(agent) : null
      const holder = at?.right ? browserIn(at.right) : frontHolder(at?.space)
      if (holder) return holder.open(url)
      const args = browserAt(url)
      window.open(paneOf(browserPane, args), at?.space, {
        focus: false,
        ...(agent ? { beside: agent } : {}),
      })
      return args.tabs[0].id
    }),
})

/** The browser Pane among `panes`, by its first tab's page. */
function browserIn(panes: readonly PaneState[]) {
  const pane = panes.find((each) => each.kind === browserPane.kind)
  const tab = pane && readArgs(pane.args as KeptArgs, "").tabs[0]
  return tab && holderOf(tab.id)
}
