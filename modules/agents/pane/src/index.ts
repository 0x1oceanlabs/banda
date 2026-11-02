/** The agents module's window part: its Panes, and its Watch on what
 * calls for the Person (ADR 0022). */
import type { SpaceId } from "@banda/contract"
import { type Action, defineModule } from "@banda/ui/module"
import { paneOf } from "@banda/ui/pane"
import { diffPane } from "./DiffPane"
import { threadPane } from "./ThreadPane"
import { threadsPane } from "./ThreadsPane"
import { threadsWatch } from "./ThreadsWatch"
import { NEW_THREAD } from "./session"

export { useSpaceFiles } from "./FileMenu"
export { useHarnesses } from "./harnesses"

/**
 * A new Thread, in a new column, on this computer's first Harness (ADR
 * 0006); one not yet started there gets the focus instead. Its args: the
 * `space` (the home Space else), and, from the Banda menu, the words to
 * `ask` at once and the `harness` (ADR 0017, decision 6).
 */
const newThread: Action = {
  id: "thread.new",
  title: "New Thread",
  section: "Threads",
  keys: [{ code: "Enter", alt: true }],
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
  panes: [threadPane, threadsPane, diffPane],
  watches: [threadsWatch],
  actions: [newThread],
})
