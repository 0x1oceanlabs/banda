/** The agents module's window part: its Panes, its Watch on what calls
 * for the Person, its action and what the Banda menu finds of it (ADR
 * 0022). */
import type { SpaceId } from "@banda/contract"
import { type Action, defineModule } from "@banda/ui/module"
import { paneOf } from "@banda/ui/pane"
import { threadPane } from "./ThreadPane"
import { visualPane } from "./VisualPane"
import { threadsWatch } from "./ThreadsWatch"
import { askSource, filesSource } from "./sources"
import { NEW_THREAD } from "./session"

/**
 * A new Thread, in a new column, on this computer's first Harness (ADR
 * 0006): a new one at each press, as a browser's new window. Its args: the
 * `space` (the home Space else), and, from the Banda menu, the words to
 * `ask` at once and the `harness` (ADR 0017, decision 6).
 */
const newThread: Action = {
  id: "thread.new",
  title: "New Thread",
  section: "Threads",
  keys: [{ code: "Enter", mod: true }],
  run: (window, args = {}) => {
    const { space, ask, harness } = args
    const thread = paneOf(threadPane, {
      ...NEW_THREAD,
      ...(typeof ask === "string" && ask && { ask }),
      ...(typeof harness === "string" && harness && { harness }),
    })
    window.open(
      thread,
      typeof space === "string" ? (space as SpaceId) : window.home
    )
  },
}

export const agents = defineModule({
  id: "agents",
  engine: true,
  panes: [threadPane, visualPane],
  watches: [threadsWatch],
  actions: [newThread],
  sources: [filesSource, askSource],
})
