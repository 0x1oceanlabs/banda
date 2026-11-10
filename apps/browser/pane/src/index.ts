/** The browser's window part: its Pane, its actions and what the Banda
 * menu finds of it (ADR 0013, ADR 0022). It has no engine part, so it is
 * always on. */
import type { ProjectId } from "@banda/contract"
import { defineModule, scoped, takes, zoomActions } from "@banda/ui/module"
import { paneOf, type PaneState } from "@banda/ui/pane"
import { searchNow } from "./address"
import { browserPane } from "./BrowserPane"
import { actionOf, BROWSER, BROWSER_KEYS, LEND } from "./keys"
import { frontHolder, holderOf, openWith } from "./pages"
import { webSource } from "./sources"
import { browserAt, type KeptArgs, NEW_BROWSER, readArgs } from "./tabs"
import { followThreads, waitsWatch } from "./threads"

export const browser = defineModule({
  id: "browser",
  engine: false,
  // Its pages are this device's: an arc page reaches it as a link, and
  // later through a forwarded port (ADR 0106, decision 2).
  device: true,
  panes: [browserPane],
  actions: [
    {
      id: "browser.new",
      title: "New browser",
      section: "Panes",
      // As Omarchy's Super+Shift+Return.
      keys: [{ code: "Enter", mod: true, shift: true }],
      run: (window) => window.open(paneOf(browserPane, NEW_BROWSER)),
    },
    {
      // A page, or `words` to search the web for: the Banda menu's words
      // as a page, and a Thread's "Search the web". A file opens in Files.
      id: "browser.open",
      args: takes({
        address: "a page's address",
        file: "a file's absolute path, to show",
        words: "words to search the web for",
        project: "the Project to open it in",
      }),
      title: "Open in a browser",
      section: "Panes",
      unlisted: true,
      run: (window, args = {}) => {
        const { address, words, project } = args
        const url =
          typeof words === "string"
            ? searchNow(words)
            : typeof address === "string"
              ? address
              : ""
        window.open(
          paneOf(browserPane, browserAt(url)),
          typeof project === "string" ? (project as ProjectId) : undefined
        )
      },
    },
    // The browser's own keys, Chrome's (ADR 0071, decision 1).
    ...BROWSER_KEYS.map(({ does, ...rest }) =>
      scoped(BROWSER, { ...rest, id: actionOf(does), section: "Browser" })
    ),
    ...zoomActions(BROWSER, BROWSER, "the page", "Browser"),
    // Banda's own key for the lend gesture (ADR 0083, decision 4); Chrome
    // has none.
    scoped(BROWSER, {
      id: LEND,
      title: "Lend the tab to a Thread, or take it back",
      section: "Browser",
      keys: [{ code: "KeyL", mod: true, shift: true }],
    }),
  ],
  scopes: [{ id: BROWSER, title: "Browser" }],
  sources: [webSource],
  watches: [waitsWatch],
  // A tab an Agent opens goes beside its Thread (ADR 0029, decision 4):
  // to the browser of the column right of the Thread's Pane, or a new
  // one there; with the Thread not shown, to its Project's browser the
  // Person was in last, or a new one. It loads in its Project's Agents'
  // profile, which the desktop names (ADR 0083, decision 4). An
  // extension's goes to the browser the Person was in last, in theirs.
  // The Person's Pane keeps the focus. A Thread drives its tabs until its
  // turn ends (`followThreads`).
  start: (window) => {
    const following = followThreads(window)
    const opening = openWith((url, { agent, agents }) => {
      const at = agent ? window.beside(agent) : null
      const holder = at?.right ? browserIn(at.right) : frontHolder(at?.project)
      if (holder) return holder.open(url, { agents })
      const args = browserAt(url, undefined, agents)
      window.open(paneOf(browserPane, args), at?.project, {
        focus: false,
        ...(agent ? { beside: agent } : {}),
      })
      return args.tabs[0].id
    })
    return () => {
      following()
      opening()
    }
  },
})

/** The browser Pane among `panes`, by its first tab's page. */
function browserIn(panes: readonly PaneState[]) {
  const pane = panes.find((each) => each.kind === browserPane.kind)
  const tab = pane && readArgs(pane.args as KeptArgs, "").tabs[0]
  return tab && holderOf(tab.id)
}
